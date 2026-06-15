/**
 * Jarvis Phase 3B: Morning Brief API & iOS Shortcut Contract Validation Suite
 */

process.env.TELEGRAM_ALLOWED_RUNTIME_CHAT_IDS = '12345';
process.env.TELEGRAM_ALLOWED_USER_IDS = '12345';
process.env.OPENCLAW_ROLE_SUPER_ADMIN_CHAT_IDS = '12345';

const express = require('express');
const axios = require('axios');
const assert = require('assert');
const crypto = require('crypto');
const { Client } = require('pg');
const jarvisRouter = require('../jarvis/routes');

const DB_URL = process.env.DATABASE_URL;
const PORT = 4568;
const BASE_URL = `http://localhost:${PORT}/api/jarvis`;

const TEST_TOKEN = 'test_iphone_shortcut_token_brief_3b';
const TEST_TOKEN_HASH = crypto.createHash('sha256').update(TEST_TOKEN).digest('hex');
const TEST_DEVICE_ID = 'test_device_999_brief';

let server;
let client;

async function setup() {
  console.log('Setting up Phase 3B validation...');
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
     VALUES ($1, 'Test iPhone Brief', $2, true, NOW() + INTERVAL '1 hour')
     ON CONFLICT (token_hash) DO UPDATE SET active = true, expires_at = NOW() + INTERVAL '1 hour';`,
    [TEST_TOKEN_HASH, TEST_DEVICE_ID]
  );
  
  // Ensure siri_summary column exists on daily briefs table
  await client.query("ALTER TABLE jarvis_daily_briefs ADD COLUMN IF NOT EXISTS siri_summary TEXT;");

  // Start Express API server
  const app = express();
  app.use(express.json());
  app.use('/api/jarvis', jarvisRouter);
  
  server = app.listen(PORT, () => {
    console.log(`[Setup] Local Express API listening on port ${PORT}`);
  });
}

async function cleanup() {
  console.log('\nCleaning up Phase 3B validation resources...');
  if (client) {
    try {
      console.log('[Cleanup] Deleting temporary seeded mobile token...');
      await client.query('DELETE FROM jarvis_mobile_tokens WHERE token_hash = $1;', [TEST_TOKEN_HASH]);
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

  // TEST 1: GET /daily-brief - 401 Unauthorized - Missing Authorization header
  try {
    await axios.get(`${BASE_URL}/daily-brief`);
    runAssert(false, 'Missing token should return 401');
  } catch (err) {
    runAssert(err.response && err.response.status === 401, '401 received for missing token');
  }
  
  // TEST 2: GET /daily-brief - 401 Unauthorized - Invalid token
  try {
    await axios.get(`${BASE_URL}/daily-brief`, {
      headers: { Authorization: 'Bearer invalid_token_xyz' }
    });
    runAssert(false, 'Invalid token should return 401');
  } catch (err) {
    runAssert(err.response && err.response.status === 401, '401 received for invalid token');
  }

  // TEST 3: GET /daily-brief - 200 OK - Valid token - JSON format
  console.log('\nEvaluating GET /daily-brief (json)...');
  const resJson = await axios.get(`${BASE_URL}/daily-brief`, {
    headers: { Authorization: `Bearer ${TEST_TOKEN}` }
  });
  runAssert(resJson.status === 200, 'Valid token returns 200 OK');
  runAssert(resJson.data.success === true, 'JSON response shows success');
  runAssert(resJson.data.raw_brief_markdown !== undefined, 'raw_brief_markdown is present');
  runAssert(resJson.data.siri_summary !== undefined, 'siri_summary is present');
  runAssert(resJson.data.siri_summary.includes('Good morning'), 'siri_summary compiles with spoken greeting');

  // TEST 4: GET /daily-brief - Idempotency Check
  console.log('\nEvaluating Idempotency...');
  // Modify the brief in the database to see if subsequent calls return the cached row
  const todayStr = new Date().toISOString().substring(0, 10);
  await client.query(
    "UPDATE jarvis_daily_briefs SET siri_summary = 'CACHED_SIRI_SUMMARY' WHERE brief_date = $1;",
    [todayStr]
  );
  
  const resCached = await axios.get(`${BASE_URL}/daily-brief`, {
    headers: { Authorization: `Bearer ${TEST_TOKEN}` }
  });
  runAssert(resCached.data.siri_summary === 'CACHED_SIRI_SUMMARY', 'Endpoint returned cached brief (idempotent)');

  // TEST 5: GET /daily-brief - refresh=true Check
  console.log('\nEvaluating refresh=true...');
  const resRefresh = await axios.get(`${BASE_URL}/daily-brief?refresh=true`, {
    headers: { Authorization: `Bearer ${TEST_TOKEN}` }
  });
  runAssert(resRefresh.data.siri_summary !== 'CACHED_SIRI_SUMMARY', 'Endpoint regenerated and updated brief when refresh=true passed');
  runAssert(resRefresh.data.siri_summary.includes('Good morning'), 'Regenerated brief has correct Siri spoken text format');

  // TEST 6: GET /daily-brief - format=siri Check (returns text/plain)
  console.log('\nEvaluating format=siri...');
  const resSiri = await axios.get(`${BASE_URL}/daily-brief?format=siri`, {
    headers: { Authorization: `Bearer ${TEST_TOKEN}` }
  });
  runAssert(resSiri.status === 200, 'format=siri returns 200 OK');
  runAssert(resSiri.headers['content-type'].includes('text/plain'), 'Content-Type is text/plain');
  runAssert(typeof resSiri.data === 'string', 'Returns string response data');
  runAssert(resSiri.data.includes('Good morning'), 'Plain text contains siri spoken brief');

  // TEST 7: GET /daily-brief - format=markdown Check (returns text/plain)
  console.log('\nEvaluating format=markdown...');
  const resMd = await axios.get(`${BASE_URL}/daily-brief?format=markdown`, {
    headers: { Authorization: `Bearer ${TEST_TOKEN}` }
  });
  runAssert(resMd.status === 200, 'format=markdown returns 200 OK');
  runAssert(resMd.headers['content-type'].includes('text/plain'), 'Content-Type is text/plain');
  runAssert(typeof resMd.data === 'string', 'Returns string response data');
  runAssert(resMd.data.includes('# 📆 Jarvis Daily Brief'), 'Plain text contains markdown title');

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
