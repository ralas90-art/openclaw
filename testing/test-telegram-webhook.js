/**
 * Jarvis Telegram Webhook Integration & Formatting Smoke Test
 */

const assert = require('assert');
const axios = require('axios');
const { handleCommand } = require('../interfaces/telegram/handlers');
const permissions = require('../openclaw/runtime/runtime-permissions');

// Mock axios to intercept outgoing Telegram sendMessage calls
let lastTelegramPayload = null;
const originalPost = axios.post;
axios.post = async function(url, data, config) {
  if (url.includes('api.telegram.org/bot')) {
    lastTelegramPayload = data;
    console.log(`[MockAxios] Intercepted Telegram outgoing payload: ${data.text.substring(0, 100)}...`);
    return { status: 200, data: { ok: true } };
  }
  return originalPost.call(axios, url, data, config);
};

const TEST_CHAT_ID = '12345';
const TEST_USER_ID = '12345';

async function runWebhookSmokeTests() {
  console.log('Starting Telegram Webhook & Outgoing Payload Integration Tests...');
  let testsPassed = 0;
  let totalTests = 0;

  function runAssert(condition, message) {
    totalTests++;
    if (condition) {
      testsPassed++;
      console.log(`Test ${totalTests} Passed: ${message}`);
    } else {
      console.error(`Test ${totalTests} Failed: ${message}`);
      process.exit(1);
    }
  }

  const mockMessage = {
    chat: { id: TEST_CHAT_ID },
    from: { id: TEST_CHAT_ID }
  };

  // Setup env variables for permissions
  process.env.TELEGRAM_ALLOWED_RUNTIME_CHAT_IDS = TEST_CHAT_ID;
  process.env.TELEGRAM_ALLOWED_USER_IDS = TEST_USER_ID;

  // TEST 1: Command Normalization & Permissions check
  const isAllowed = permissions.isCommandAllowed('/jarvis_brief', TEST_CHAT_ID);
  runAssert(isAllowed === true, 'Admin chat ID is authorized for /jarvis_brief');

  // TEST 2: /jarvis_brief formatting & message limits
  console.log('\n[Smoke Test] Evaluating /jarvis_brief payload formatting...');
  const briefText = await handleCommand('/jarvis_brief', mockMessage);
  runAssert(briefText.length < 4096, `Message length (${briefText.length}) is within Telegram's 4096-char limit`);
  runAssert(briefText.includes('*') || briefText.includes('`'), 'Contains standard Markdown formatting');
  runAssert(!briefText.includes('undefined') && !briefText.includes('null'), 'Contains no unhandled null or undefined properties');
  runAssert(!briefText.includes('pg') && !briefText.includes('Connection'), 'Does not leak raw SQL query logs or database credentials');

  // TEST 3: /jarvis_project formatting
  console.log('\n[Smoke Test] Evaluating /jarvis_project septivolt formatting...');
  const projText = await handleCommand('/jarvis_project septivolt', mockMessage);
  runAssert(projText.includes('Project Status Card: SeptiVolt'), 'Project Card title matches');
  runAssert(projText.length < 4096, 'Project card fits within Telegram limits');

  // TEST 4: Fail-gracefully on missing DATABASE_URL
  console.log('\n[Smoke Test] Testing graceful fallback on missing DATABASE_URL...');
  const originalDbUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL; // Simulate empty DB_URL
  
  try {
    const fallbackText = await handleCommand('/jarvis_brief', mockMessage);
    runAssert(fallbackText !== undefined, 'Brief executes even when DATABASE_URL is missing');
    runAssert(fallbackText.includes('Warning') || fallbackText.includes('registry') || fallbackText.includes('Brief'), 'Returns warning or brief status cleanly');
  } catch (err) {
    runAssert(false, 'Gracefully handles empty DATABASE_URL without crashing');
  }
  
  // Restore DATABASE_URL
  process.env.DATABASE_URL = originalDbUrl;

  console.log(`\nTelegram Smoke Tests Complete! Passed ${testsPassed} of ${totalTests} tests.`);
}

runWebhookSmokeTests().catch(err => {
  console.error('Fatal smoke test error:', err.message);
  process.exit(1);
});
