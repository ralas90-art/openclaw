/**
 * Jarvis Phase 3C: Media URL Intake Validation Suite
 */

// Set up environment variables at the very top before requiring modules
process.env.TELEGRAM_ALLOWED_RUNTIME_CHAT_IDS = '12345';
process.env.TELEGRAM_ALLOWED_USER_IDS = '12345';
process.env.OPENCLAW_ROLE_SUPER_ADMIN_CHAT_IDS = '12345';

const express = require('express');
const axios = require('axios');
const assert = require('assert');
const crypto = require('crypto');
const { Client } = require('pg');
const jarvisRouter = require('../jarvis/routes');
const { handleCommand } = require('../interfaces/telegram/handlers');

const DB_URL = process.env.DATABASE_URL;
const PORT = 4569;
const BASE_URL = `http://localhost:${PORT}/api/jarvis`;

const TEST_TOKEN = 'test_iphone_shortcut_token_media_123';
const TEST_TOKEN_HASH = crypto.createHash('sha256').update(TEST_TOKEN).digest('hex');
const TEST_DEVICE_ID = 'test_device_media_999';

let server;
let client;

async function setup() {
  console.log('Setting up Phase 3C validation...');
  if (!DB_URL) {
    console.error('Error: DATABASE_URL is not set.');
    process.exit(1);
  }
  
  client = new Client({ connectionString: DB_URL });
  await client.connect();
  
  // Seed test token
  console.log('[Setup] Seeding temporary mobile token...');
  await client.query(
    `INSERT INTO jarvis_mobile_tokens (token_hash, device_name, device_id, active, expires_at)
     VALUES ($1, 'Test iPhone Media', $2, true, NOW() + INTERVAL '1 hour')
     ON CONFLICT (token_hash) DO UPDATE SET active = true, expires_at = NOW() + INTERVAL '1 hour';`,
    [TEST_TOKEN_HASH, TEST_DEVICE_ID]
  );
  
  // Start Express API server
  const app = express();
  app.use(express.json());
  app.use('/api/jarvis', jarvisRouter);
  
  server = app.listen(PORT, () => {
    console.log(`[Setup] Local Express API listening on port ${PORT}`);
  });
}

async function cleanup() {
  console.log('\nCleaning up Phase 3C validation resources...');
  if (client) {
    try {
      console.log('[Cleanup] Deleting temporary seeded mobile token...');
      await client.query('DELETE FROM jarvis_mobile_tokens WHERE token_hash = $1;', [TEST_TOKEN_HASH]);
      
      console.log('[Cleanup] Deleting temporary mobile uploads generated during test...');
      await client.query("DELETE FROM jarvis_mobile_uploads WHERE text_content LIKE 'Phase 3C Test%';");
      await client.query("DELETE FROM jarvis_mobile_uploads WHERE text_content IS NULL AND task_type IN ('screenshot', 'photo');");
      
      await client.end();
    } catch (err) {
      console.error('[Cleanup Error]', err.message);
    }
  }
  if (server) {
    server.close();
  }
  console.log('Cleanup completed.');
}

async function runTests() {
  let testsPassed = 0;
  let totalTests = 0;
  
  function runAssert(condition, message) {
    totalTests++;
    if (condition) {
      testsPassed++;
      console.log(`✅ Test ${totalTests} Passed: ${message}`);
    } else {
      console.error(`❌ Test ${totalTests} Failed: ${message}`);
      throw new Error(`Test failure: ${message}`);
    }
  }

  // TEST 1: 401 Unauthorized - Missing/Invalid token
  try {
    await axios.post(`${BASE_URL}/mobile-intake`, {
      intake_source: 'shortcut',
      task_type: 'screenshot',
      media_url: 'https://postgres.supabase.co/storage/v1/object/public/screen.png'
    });
    runAssert(false, 'Missing token should return 401');
  } catch (err) {
    runAssert(err.response && err.response.status === 401, '401 received for missing token');
  }

  // TEST 2: 400 Bad Request - Invalid task_type
  try {
    await axios.post(`${BASE_URL}/mobile-intake`, {
      intake_source: 'shortcut',
      task_type: 'video',
      media_url: 'https://postgres.supabase.co/storage/v1/object/public/screen.png'
    }, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` }
    });
    runAssert(false, 'Invalid task_type should return 400');
  } catch (err) {
    runAssert(err.response && err.response.status === 400, '400 received for invalid task_type');
  }

  // TEST 3: 400 Bad Request - Missing media_url for screenshot
  try {
    await axios.post(`${BASE_URL}/mobile-intake`, {
      intake_source: 'shortcut',
      task_type: 'screenshot',
      text_content: 'Phase 3C Test screenshot missing URL'
    }, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` }
    });
    runAssert(false, 'Missing media_url should return 400');
  } catch (err) {
    runAssert(err.response && err.response.status === 400, '400 received for missing media_url');
    runAssert(err.response.data.error.includes('media_url is required'), 'Error mentions media_url requirement');
  }

  // TEST 4: 400 Bad Request - Invalid media_url domain
  try {
    await axios.post(`${BASE_URL}/mobile-intake`, {
      intake_source: 'shortcut',
      task_type: 'screenshot',
      media_url: 'https://sketchy-public-host.com/image.png'
    }, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` }
    });
    runAssert(false, 'Invalid media_url domain should return 400');
  } catch (err) {
    runAssert(err.response && err.response.status === 400, '400 received for invalid media_url domain');
    runAssert(err.response.data.error.includes('approved storage provider'), 'Error mentions approved storage provider');
  }

  // TEST 5: 400 Bad Request - file:// URL blocked
  try {
    await axios.post(`${BASE_URL}/mobile-intake`, {
      intake_source: 'shortcut',
      task_type: 'screenshot',
      media_url: 'file:///etc/passwd'
    }, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` }
    });
    runAssert(false, 'file:// URL should return 400');
  } catch (err) {
    runAssert(err.response && err.response.status === 400, '400 received for file:// protocol');
  }

  // TEST 6: 201 Created - Valid screenshot intake (with Supabase storage subdomain)
  const validScreenshotRes = await axios.post(`${BASE_URL}/mobile-intake`, {
    intake_source: 'shortcut',
    task_type: 'screenshot',
    media_url: 'https://project-id.supabase.co/storage/v1/object/public/screen1.png',
    text_content: 'Phase 3C Test screenshot caption'
  }, {
    headers: { Authorization: `Bearer ${TEST_TOKEN}` }
  });
  runAssert(validScreenshotRes.status === 201, 'Valid screenshot returns 201');
  const screenshotRecord = validScreenshotRes.data.data;
  runAssert(screenshotRecord.task_type === 'screenshot', 'Saved task_type is screenshot');
  runAssert(screenshotRecord.media_url === 'https://project-id.supabase.co/storage/v1/object/public/screen1.png', 'Saved media_url is correct');
  runAssert(screenshotRecord.text_content === 'Phase 3C Test screenshot caption', 'Saved caption is correct');
  runAssert(screenshotRecord.processed === false, 'processed is explicitly false');

  // TEST 7: 201 Created - Valid photo intake (with Google Drive domain and optional caption omitted)
  const validPhotoRes = await axios.post(`${BASE_URL}/mobile-intake`, {
    intake_source: 'shortcut',
    task_type: 'photo',
    media_url: 'https://drive.google.com/file/d/12345/view'
  }, {
    headers: { Authorization: `Bearer ${TEST_TOKEN}` }
  });
  runAssert(validPhotoRes.status === 201, 'Valid photo returns 201');
  const photoRecord = validPhotoRes.data.data;
  runAssert(photoRecord.task_type === 'photo', 'Saved task_type is photo');
  runAssert(photoRecord.media_url === 'https://drive.google.com/file/d/12345/view', 'Saved media_url is correct');
  runAssert(photoRecord.text_content === null, 'text_content is successfully null (optional caption)');

  // TEST 8: /jarvis_mobile_inbox Telegram output formatting
  const mockMessage = {
    chat: { id: 12345 },
    from: { id: 12345 }
  };
  const inboxText = await handleCommand('/jarvis_mobile_inbox', mockMessage);
  runAssert(inboxText.includes('Unprocessed Mobile Inbox'), 'Inbox title matches');
  runAssert(inboxText.includes('[View Attachment](https://project-id.supabase.co/storage/v1/object/public/screen1.png)'), 'Clickable screenshot media link is formatted correctly');
  runAssert(inboxText.includes('[View Attachment](https://drive.google.com/file/d/12345/view)'), 'Clickable photo media link is formatted correctly');
  runAssert(inboxText.includes('Phase 3C Test screenshot caption'), 'Caption text is printed in output');

  // TEST 9: Permission Summary (Command /run_permissions) shows triage commands under State Mutation
  const summaryText = await handleCommand('/run_permissions', mockMessage);
  runAssert(summaryText.includes('State Mutation'), 'Permission summary prints State Mutation tier header');
  runAssert(summaryText.includes('/jarvis_mark_processed'), 'mark processed is under State Mutation');
  runAssert(summaryText.includes('/jarvis_process_inbox'), 'process inbox is under State Mutation');

  // TEST 10: Gating localhost/HTTP in production env
  process.env.NODE_ENV = 'production';
  try {
    await axios.post(`${BASE_URL}/mobile-intake`, {
      intake_source: 'shortcut',
      task_type: 'photo',
      media_url: 'http://localhost/image.png'
    }, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` }
    });
    runAssert(false, 'Localhost/HTTP should be blocked in production');
  } catch (err) {
    runAssert(err.response && err.response.status === 400, '400 received for localhost/HTTP in production');
  } finally {
    process.env.NODE_ENV = 'test'; // Restore env
  }

  console.log(`\n🎉 Phase 3C Validation Complete! Passed 10 of 10 tests.`);
}

async function run() {
  try {
    await setup();
    await runTests();
  } finally {
    await cleanup();
  }
}

run().catch(err => {
  console.error('Fatal execution error:', err.message);
  process.exit(1);
});
