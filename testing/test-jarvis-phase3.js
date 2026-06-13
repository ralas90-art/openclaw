/**
 * Jarvis Phase 3A: Mobile Intake API Validation Suite
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
const PORT = 4567;
const BASE_URL = `http://localhost:${PORT}/api/jarvis`;

const TEST_TOKEN = 'test_iphone_shortcut_token_abc123';
const TEST_TOKEN_HASH = crypto.createHash('sha256').update(TEST_TOKEN).digest('hex');
const TEST_DEVICE_ID = 'test_device_999';

let server;
let client;

async function setup() {
  console.log('Setting up Phase 3A validation...');
  if (!DB_URL) {
    console.error('Error: DATABASE_URL is not set.');
    process.exit(1);
  }
  
  // Connect to Supabase
  client = new Client({ connectionString: DB_URL });
  await client.connect();
  
  // Seed test token
  console.log('[Setup] Seeding temporary mobile token...');
  await client.query(
    `INSERT INTO jarvis_mobile_tokens (token_hash, device_name, device_id, active, expires_at)
     VALUES ($1, 'Test iPhone XR', $2, true, NOW() + INTERVAL '1 hour')
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
  console.log('\nCleaning up Phase 3A validation resources...');
  if (client) {
    try {
      console.log('[Cleanup] Deleting temporary seeded mobile token...');
      await client.query('DELETE FROM jarvis_mobile_tokens WHERE token_hash = $1;', [TEST_TOKEN_HASH]);
      
      console.log('[Cleanup] Deleting temporary mobile uploads generated during test...');
      await client.query("DELETE FROM jarvis_mobile_uploads WHERE text_content LIKE 'Phase 3A Test Note%';");
      
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

  // TEST 1: 401 Unauthorized - Missing Authorization header
  try {
    await axios.post(`${BASE_URL}/mobile-intake`, {
      intake_source: 'shortcut',
      task_type: 'text',
      text_content: 'Phase 3A Test Note'
    });
    runAssert(false, 'Missing token should return 401');
  } catch (err) {
    runAssert(err.response && err.response.status === 401, '401 received for missing token');
  }
  
  // TEST 2: 401 Unauthorized - Invalid token
  try {
    await axios.post(`${BASE_URL}/mobile-intake`, {
      intake_source: 'shortcut',
      task_type: 'text',
      text_content: 'Phase 3A Test Note'
    }, {
      headers: { Authorization: 'Bearer invalid_token_xyz' }
    });
    runAssert(false, 'Invalid token should return 401');
  } catch (err) {
    runAssert(err.response && err.response.status === 401, '401 received for invalid token');
    runAssert(err.response.data && !err.response.data.error.includes(TEST_TOKEN_HASH), 'Error message does not leak token hash');
  }

  // TEST 3: 400 Bad Request - Missing intake_source
  try {
    await axios.post(`${BASE_URL}/mobile-intake`, {
      task_type: 'text',
      text_content: 'Phase 3A Test Note'
    }, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` }
    });
    runAssert(false, 'Missing intake_source should return 400');
  } catch (err) {
    runAssert(err.response && err.response.status === 400, '400 received for missing intake_source');
  }

  // TEST 4: 400 Bad Request - Invalid intake_source
  try {
    await axios.post(`${BASE_URL}/mobile-intake`, {
      intake_source: 'unsupported_source',
      task_type: 'text',
      text_content: 'Phase 3A Test Note'
    }, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` }
    });
    runAssert(false, 'Invalid intake_source should return 400');
  } catch (err) {
    runAssert(err.response && err.response.status === 400, '400 received for invalid intake_source');
  }

  // TEST 5: 400 Bad Request - task_type !== 'text' (Strict Phase 3A Constraint)
  try {
    await axios.post(`${BASE_URL}/mobile-intake`, {
      intake_source: 'shortcut',
      task_type: 'screenshot',
      text_content: 'Phase 3A Test Note'
    }, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` }
    });
    runAssert(false, "task_type = 'screenshot' should be rejected in Phase 3A");
  } catch (err) {
    runAssert(err.response && err.response.status === 400, '400 received for screenshot task_type in Phase 3A');
    runAssert(err.response.data.error.includes("strictly 'text'"), 'Error details mentions Phase 3A constraint');
  }

  // TEST 6: 400 Bad Request - text_content too long (> 5000 characters)
  try {
    const hugeText = 'A'.repeat(5001);
    await axios.post(`${BASE_URL}/mobile-intake`, {
      intake_source: 'shortcut',
      task_type: 'text',
      text_content: hugeText
    }, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` }
    });
    runAssert(false, 'Text > 5000 characters should return 400');
  } catch (err) {
    runAssert(err.response && err.response.status === 400, '400 received for text content length overflow');
  }

  // TEST 7: 400 Bad Request - invalid project_slug
  try {
    await axios.post(`${BASE_URL}/mobile-intake`, {
      intake_source: 'shortcut',
      task_type: 'text',
      text_content: 'Phase 3A Test Note',
      project_slug: 'non-existent-project'
    }, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` }
    });
    runAssert(false, 'Invalid project_slug should return 400');
  } catch (err) {
    runAssert(err.response && err.response.status === 400, '400 received for invalid project slug');
  }

  // TEST 8: 201 Created - Valid text intake
  const validResponse = await axios.post(`${BASE_URL}/mobile-intake`, {
    intake_source: 'shortcut',
    task_type: 'text',
    text_content: 'Phase 3A Test Note - Successful upload',
    notes: 'Testing notes metadata',
    project_slug: 'septivolt'
  }, {
    headers: { Authorization: `Bearer ${TEST_TOKEN}` }
  });
  runAssert(validResponse.status === 201, 'Valid upload returns 201 Created');
  runAssert(validResponse.data.success === true, 'Response JSON success property is true');
  
  const createdRecord = validResponse.data.data;
  runAssert(createdRecord.processed === false, 'Explicitly sets processed = false');
  runAssert(createdRecord.intake_source === 'shortcut', 'intake_source matches');
  runAssert(createdRecord.task_type === 'text', 'task_type matches');
  runAssert(createdRecord.project_slug === 'septivolt', 'project_slug resolves correctly');
  runAssert(createdRecord.text_content === 'Phase 3A Test Note - Successful upload', 'text_content is matching');

  // TEST 9: Row exists in live database
  const dbRows = await client.query(
    "SELECT * FROM jarvis_mobile_uploads WHERE id = $1;",
    [createdRecord.id]
  );
  runAssert(dbRows.rows.length === 1, 'Supabase contains the new mobile upload row');
  runAssert(dbRows.rows[0].processed === false, 'Supabase record states processed = false');

  // TEST 10: 429 Too Many Requests - Rate limiting (Limit is 10 requests per minute)
  console.log('Evaluating rate limiter (sending 11 rapid requests)...');
  let status429Received = false;
  try {
    for (let i = 0; i < 12; i++) {
      await axios.post(`${BASE_URL}/mobile-intake`, {
        intake_source: 'shortcut',
        task_type: 'text',
        text_content: `Phase 3A Test Note - Rate limit check ${i}`
      }, {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` }
      });
    }
  } catch (err) {
    if (err.response && err.response.status === 429) {
      status429Received = true;
    }
  }
  runAssert(status429Received === true, '429 Too Many Requests is triggered on rate limit overflow');

  // TEST 11: Telegram /jarvis_mobile_inbox command output formatting
  const mockMessage = {
    chat: { id: 12345 },
    from: { id: 12345 }
  };
  console.log('\n[Telegram Command Test] Evaluating /jarvis_mobile_inbox output...');
  const telegramText = await handleCommand('/jarvis_mobile_inbox', mockMessage);
  runAssert(telegramText.includes('Unprocessed Mobile Inbox'), 'Inbox title is printed correctly');
  runAssert(telegramText.includes('Phase 3A Test Note'), 'Seeded mobile upload text is present in the markdown output');
  runAssert(!telegramText.includes('undefined') && !telegramText.includes('null'), 'No unhandled undefined or null values');

  console.log(`\nAll Tests Completed! Passed ${testsPassed} of ${totalTests} tests.`);
}

async function main() {
  try {
    await setup();
    await runTests();
  } catch (err) {
    console.error('Test run failed:', err.message);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

main();
