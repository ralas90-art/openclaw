const fs = require('fs');
const path = require('path');

// 1. Setup mock workspace root and environment
const mockWorkspace = path.join(__dirname, 'mock-workspace-' + Date.now());
fs.mkdirSync(path.join(mockWorkspace, 'openclaw', 'inbox', 'telegram-requests'), { recursive: true });
process.env.OPENCLAW_WORKSPACE_ROOT = mockWorkspace;

// Import handlers from the active workspace
const handlers = require('../playground/primal-astro/interfaces/telegram/handlers');
const { handleCommand } = handlers;

const inboxRequestsDir = path.join(mockWorkspace, 'openclaw', 'inbox', 'telegram-requests');

console.log('Setup completed. Mock inbox directory:', inboxRequestsDir);

// 2. Helper to write mock files
function writeMockRequest(filename, payload, mtimeOffsetMs = 0) {
  const filePath = path.join(inboxRequestsDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  
  // Update modified time if offset is given
  if (mtimeOffsetMs) {
    const time = (Date.now() + mtimeOffsetMs) / 1000;
    fs.utimesSync(filePath, time, time);
  }
}

async function runTests() {
  console.log('\n--- Running Test 1: Empty Inbox ---');
  let res = await handleCommand('/inbox', { chat: { id: 123 } });
  console.log('Result:\n', res);
  if (res.includes('OpenClaw Inbox is empty.')) {
    console.log('✓ Test 1 Passed.');
  } else {
    console.error('❌ Test 1 Failed.');
  }

  // Write some mock files
  console.log('\nWriting mock requests...');
  // File 1: Oldest
  writeMockRequest('telegram_2026-05-26_10-00-00_content-forge_image-prompts.json', {
    status: 'queued',
    bot: 'content-forge',
    workflow: 'image-prompts',
    fields: { Project: 'SeptiVolt', Campaign: 'Batch 001 Oldest' },
    timestamp: '2026-05-26T10:00:00.000Z'
  }, -100000);

  // File 2: Middle
  writeMockRequest('telegram_2026-05-26_11-00-00_content-forge_image-prompts.json', {
    status: 'queued',
    bot: 'content-forge',
    workflow: 'image-prompts',
    fields: { Project: 'SeptiVolt', Campaign: 'Batch 002 Middle' },
    timestamp: '2026-05-26T11:00:00.000Z'
  }, -50000);

  // File 3: Newest
  writeMockRequest('telegram_2026-05-26_12-00-00_content-forge_image-prompts.json', {
    status: 'queued',
    bot: 'content-forge',
    workflow: 'image-prompts',
    fields: { Project: 'SeptiVolt', Campaign: 'Batch 003 Newest' },
    timestamp: '2026-05-26T12:00:00.000Z'
  }, 0);

  // File 4: Non-request file pattern (should be ignored)
  fs.writeFileSync(path.join(inboxRequestsDir, 'test.txt'), 'hello');
  
  // File 5: Invalid JSON request (written with an older mtime so it doesn't preempt the latest check)
  const invalidPath = path.join(inboxRequestsDir, 'telegram_2026-05-26_13-00-00_invalid.json');
  fs.writeFileSync(invalidPath, 'invalid json data');
  const time = (Date.now() - 200000) / 1000;
  fs.utimesSync(invalidPath, time, time);

  console.log('\n--- Running Test 2: List Inbox (Sorted by mtime descending) ---');
  res = await handleCommand('/inbox', { chat: { id: 123 } });
  console.log('Result:\n', res);
  if (res.includes('Batch 003 Newest') && res.includes('Batch 002 Middle') && res.includes('Batch 001 Oldest') && !res.includes('test.txt')) {
    console.log('✓ Test 2 Passed.');
  } else {
    console.error('❌ Test 2 Failed.');
  }

  console.log('\n--- Running Test 3: Latest Inbox Request ---');
  res = await handleCommand('/inbox_latest', { chat: { id: 123 } });
  console.log('Result:\n', res);
  if (res.includes('Batch 003 Newest')) {
    console.log('✓ Test 3 Passed.');
  } else {
    console.error('❌ Test 3 Failed.');
  }

  console.log('\n--- Running Test 4: Read Valid File ---');
  const filenameToRead = 'telegram_2026-05-26_12-00-00_content-forge_image-prompts.json';
  res = await handleCommand(`/inbox_read ${filenameToRead}`, { chat: { id: 123 } });
  console.log('Result:\n', res);
  if (res.includes('OpenClaw Request Details') && res.includes('Batch 003 Newest')) {
    console.log('✓ Test 4 Passed.');
  } else {
    console.error('❌ Test 4 Failed.');
  }

  console.log('\n--- Running Test 5: Path Traversal Security Block (/etc/passwd) ---');
  res = await handleCommand('/inbox_read ../../../etc/passwd', { chat: { id: 123 } });
  console.log('Result:\n', res);
  if (res.includes('Access denied')) {
    console.log('✓ Test 5 Passed.');
  } else {
    console.error('❌ Test 5 Failed.');
  }

  console.log('\n--- Running Test 6: Absolute Path Traversal Security Block (/etc/passwd) ---');
  res = await handleCommand('/inbox_read /etc/passwd', { chat: { id: 123 } });
  console.log('Result:\n', res);
  if (res.includes('Access denied')) {
    console.log('✓ Test 6 Passed.');
  } else {
    console.error('❌ Test 6 Failed.');
  }

  console.log('\n--- Running Test 7: Non-JSON File extension Block ---');
  res = await handleCommand('/inbox_read test.txt', { chat: { id: 123 } });
  console.log('Result:\n', res);
  if (res.includes('Access denied')) {
    console.log('✓ Test 7 Passed.');
  } else {
    console.error('❌ Test 7 Failed.');
  }

  console.log('\n--- Running Test 8: Missing File Check ---');
  res = await handleCommand('/inbox_read telegram_2026-05-26_00-00-00_missing.json', { chat: { id: 123 } });
  console.log('Result:\n', res);
  if (res.includes('File not found')) {
    console.log('✓ Test 8 Passed.');
  } else {
    console.error('❌ Test 8 Failed.');
  }

  console.log('\n--- Running Test 9: Safe Error for Invalid JSON File ---');
  res = await handleCommand('/inbox_read telegram_2026-05-26_13-00-00_invalid.json', { chat: { id: 123 } });
  console.log('Result:\n', res);
  if (res.includes('Could not parse request file')) {
    console.log('✓ Test 9 Passed.');
  } else {
    console.error('❌ Test 9 Failed.');
  }

  // Cleanup
  console.log('\nCleaning up mock workspace...');
  fs.rmSync(mockWorkspace, { recursive: true, force: true });
  console.log('Done!');
}

runTests().catch(err => {
  console.error('Unhandled error running tests:', err);
});
