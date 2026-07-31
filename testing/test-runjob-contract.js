/**
 * Regression Test Suite — /runjob Job-ID Contract Mismatch Fix
 */

const assert = require('assert');
const { generateRuntimeJobId, isValidRuntimeJobId } = require('../openclaw/runtime/runtime-job-id');
const { handleCommand } = require('../interfaces/telegram/handlers');
const { buildJobSummary } = require('../openclaw/runtime/runtime-job-inspector');
const { logEvent } = require('../openclaw/runtime/runtime-logger');
const { indexResultFile } = require('../openclaw/runtime/runtime-job-index');

process.env.OPENCLAW_ROLE_SUPER_ADMIN_CHAT_IDS = '12345';
process.env.TELEGRAM_ALLOWED_USER_IDS = '12345';
process.env.NODE_ENV = 'test';

async function runRegressionTests() {
  console.log('🧪 Starting /runjob Contract Mismatch Regression Test Suite...');

  // 1. Newly generated ID is accepted by isValidRuntimeJobId
  const newId = generateRuntimeJobId();
  console.log('  1. Generated new ID:', newId);
  assert.ok(newId.startsWith('r_'), 'New ID must start with r_ prefix');
  assert.strictEqual(isValidRuntimeJobId(newId), true, 'Newly generated ID must pass isValidRuntimeJobId');

  // 2. Historical rt_ format remains supported
  const legacyId = 'rt_20260604_143022_a7f3c9';
  assert.strictEqual(isValidRuntimeJobId(legacyId), true, 'Historical rt_ prefix ID must remain valid');

  // 3. Exact user prompt ID format r_20260731_005418_8ade43 is valid
  const exactPromptId = 'r_20260731_005418_8ade43';
  assert.strictEqual(isValidRuntimeJobId(exactPromptId), true, 'r_20260731_005418_8ade43 must be accepted by validator');

  // 4. Malformed IDs are strictly rejected
  const malformedIds = [
    'r_123',
    'r_20260731_005418',
    'r_20260731_005418_xyz',
    'rt_invalid_format',
    '12345',
    'r_20260731_005418_8ade43_extra'
  ];
  for (const badId of malformedIds) {
    assert.strictEqual(isValidRuntimeJobId(badId), false, `Malformed ID ${badId} must be rejected`);
    assert.strictEqual(buildJobSummary(badId), '❌ Rejection: Invalid job ID format.', `buildJobSummary must reject malformed ID ${badId}`);
  }

  // 5. Path traversal inputs are strictly rejected
  const traversalInputs = [
    'r_../../etc/passwd',
    'rt_..\\..\\windows\\system32',
    'r_20260731_005418_8ade43/../secret',
    '../r_20260731_005418_8ade43'
  ];
  for (const badInput of traversalInputs) {
    assert.strictEqual(isValidRuntimeJobId(badInput), false, `Path traversal input ${badInput} must be rejected`);
    assert.strictEqual(buildJobSummary(badInput), '❌ Rejection: Invalid job ID format.', `buildJobSummary must reject traversal input ${badInput}`);
  }

  // 6. Valid but nonexistent ID returns "No runtime job found for that ID."
  const nonexistentId = 'r_20260731_999999_ffffff';
  assert.strictEqual(isValidRuntimeJobId(nonexistentId), true);
  const nonExistentRes = buildJobSummary(nonexistentId);
  assert.strictEqual(nonExistentRes, 'No runtime job found for that ID.', 'Nonexistent valid ID must return job not found');

  // 7. /runjob with no ID returns accurate usage example
  const noArgsRes = await handleCommand('/runjob', '12345', '12345');
  assert.ok(noArgsRes.includes('Usage: /run_job <job_id>'), 'Usage string must instruct /run_job');
  assert.ok(noArgsRes.includes('Example: /run_job r_20260731_005418_8ade43'), 'Usage example must use canonical r_ format');

  // 8. Round-trip creation, storage, command parsing, and retrieval
  const testJobId = generateRuntimeJobId();
  logEvent({
    jobId: testJobId,
    type: 'runtime_execution',
    command: 'run_bot',
    botSlug: 'content-forge',
    status: 'success',
    durationMs: 1200,
    senderChatId: '12345',
    safeMessage: 'Test execution succeeded'
  });

  // Query via /runjob testJobId
  const runJobCmdRes = await handleCommand(`/runjob ${testJobId}`, '12345', '12345');
  assert.ok(!runJobCmdRes.includes('Rejection'), 'Telegram /runjob command must not return format rejection for valid ID');
  assert.ok(runJobCmdRes.includes(testJobId), 'Returned summary must contain the exact job ID');
  assert.ok(runJobCmdRes.toLowerCase().includes('content-forge'), 'Returned summary must contain bot info');

  // Also query via alias /run_job testJobId
  const runJobAliasRes = await handleCommand(`/run_job ${testJobId}`, '12345', '12345');
  assert.strictEqual(runJobAliasRes, runJobCmdRes, '/run_job and /runjob must produce identical results');

  // 9. Other commands remain unaffected
  const helpRes = await handleCommand('/help', '12345', '12345');
  assert.ok(helpRes.includes('Available Commands'), '/help command must function normally');

  console.log('🎉 ALL 10 REGRESSION TESTS PASSED 100% CLEANLY!');
}

runRegressionTests().catch(err => {
  console.error('❌ REGRESSION TEST FAILED:', err);
  process.exit(1);
});
