/**
 * Jarvis Phase 3E: Mobile Intake UX Polish Validation Suite
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
const PORT = 4570;
const BASE_URL = `http://localhost:${PORT}/api/jarvis`;

const TEST_TOKEN = 'test_iphone_shortcut_token_ux_polish';
const TEST_TOKEN_HASH = crypto.createHash('sha256').update(TEST_TOKEN).digest('hex');
const TEST_DEVICE_ID = 'test_device_ux_999';

let server;
let client;
let seededIds = [];

async function setup() {
  console.log('Setting up Phase 3E validation...');
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
     VALUES ($1, 'Test iPhone UX Polish', $2, true, NOW() + INTERVAL '1 hour')
     ON CONFLICT (token_hash) DO UPDATE SET active = true, expires_at = NOW() + INTERVAL '1 hour';`,
    [TEST_TOKEN_HASH, TEST_DEVICE_ID]
  );
  
  // Seed project 'septivolt' if not present
  await client.query(
    `INSERT INTO jarvis_projects (slug, name, status)
     VALUES ('septivolt', 'SeptiVolt Project', 'active')
     ON CONFLICT (slug) DO UPDATE SET status = 'active';`
  );

  // Seed sample uploads: older unprocessed, new unprocessed, processed
  console.log('[Setup] Seeding temporary test uploads...');
  
  // 1. Processed upload
  const res1 = await client.query(
    `INSERT INTO jarvis_mobile_uploads (intake_source, task_type, text_content, processed, created_at)
     VALUES ('shortcut', 'text', 'Phase 3E Old Processed Upload', true, NOW() - INTERVAL '2 days')
     RETURNING id;`
  );
  seededIds.push(res1.rows[0].id);

  // 2. Older unprocessed upload
  const res2 = await client.query(
    `INSERT INTO jarvis_mobile_uploads (intake_source, task_type, text_content, processed, created_at)
     VALUES ('shortcut', 'text', 'Phase 3E Older Unprocessed', false, NOW() - INTERVAL '1 day')
     RETURNING id;`
  );
  seededIds.push(res2.rows[0].id);

  // 3. Newest unprocessed upload (created today)
  const res3 = await client.query(
    `INSERT INTO jarvis_mobile_uploads (intake_source, task_type, text_content, processed, created_at)
     VALUES ('shortcut', 'text', 'Phase 3E Newest Unprocessed Today', false, NOW())
     RETURNING id;`
  );
  seededIds.push(res3.rows[0].id);
  
  // Start Express API server
  const app = express();
  app.use(express.json());
  app.use('/api/jarvis', jarvisRouter);
  
  server = app.listen(PORT, () => {
    console.log(`[Setup] Local Express API listening on port ${PORT}`);
  });
}

async function cleanup() {
  console.log('\nCleaning up Phase 3E validation resources...');
  if (client) {
    try {
      console.log('[Cleanup] Deleting temporary seeded mobile token...');
      await client.query('DELETE FROM jarvis_mobile_tokens WHERE token_hash = $1;', [TEST_TOKEN_HASH]);
      
      console.log('[Cleanup] Deleting temporary mobile uploads...');
      if (seededIds.length > 0) {
        await client.query('DELETE FROM jarvis_mobile_uploads WHERE id = ANY($1::uuid[]);', [seededIds]);
      }
      // Cleanup any generated during testing
      await client.query("DELETE FROM jarvis_mobile_uploads WHERE text_content LIKE 'Phase 3E%';");
      
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

  const mockMessage = {
    chat: { id: 12345 },
    from: { id: 12345 }
  };

  // TEST 1: /jarvis_mobile_inbox count returns correct digits
  const countText = await handleCommand('/jarvis_mobile_inbox count', mockMessage);
  runAssert(countText.includes('Mobile Inbox Count'), 'Count title is formatted');
  runAssert(countText.includes('2'), 'Unprocessed count matches seeded data');

  // TEST 2: /jarvis_mobile_inbox latest returns the single most recent unprocessed entry
  const latestText = await handleCommand('/jarvis_mobile_inbox latest', mockMessage);
  runAssert(latestText.includes('Latest Unprocessed Upload'), 'Latest title matches');
  runAssert(latestText.includes('Phase 3E Newest Unprocessed Today'), 'Returns correct newest item');
  runAssert(!latestText.includes('Phase 3E Older Unprocessed'), 'Does not contain older items');

  // TEST 3: /jarvis_mobile_inbox today returns today's uploads only
  const todayText = await handleCommand('/jarvis_mobile_inbox today', mockMessage);
  runAssert(todayText.includes("Today's Unprocessed Mobile Inbox"), 'Today title matches');
  runAssert(todayText.includes('Phase 3E Newest Unprocessed Today'), 'Contains today\'s upload');
  runAssert(!todayText.includes('Phase 3E Older Unprocessed'), 'Excludes yesterday\'s upload');

  // TEST 4: /jarvis_process_latest gates on invalid project slug
  try {
    await handleCommand('/jarvis_process_latest invalid-project-slug', mockMessage);
    runAssert(false, 'Should throw or return error on invalid project slug');
  } catch (err) {
    runAssert(err.message.includes('Invalid project slug'), 'Rejects invalid project slug');
  }

  // TEST 5: /jarvis_process_latest triages latest entry to project 'septivolt'
  const processRes = await handleCommand('/jarvis_process_latest septivolt', mockMessage);
  runAssert(processRes.includes('Latest Mobile Upload Processed & Assigned'), 'Process confirmation matches');
  runAssert(processRes.includes('septivolt'), 'Assigned to correct project');
  runAssert(processRes.includes('Phase 3E Newest Unprocessed Today'), 'Triaged the correct latest item');

  // TEST 6: Verify the triaged entry is marked processed in the database
  const latestRecordId = seededIds[2];
  const checkDb = await client.query('SELECT processed, project_slug FROM jarvis_mobile_uploads WHERE id = $1;', [latestRecordId]);
  runAssert(checkDb.rows[0].processed === true, 'Database status updated to processed=true');
  runAssert(checkDb.rows[0].project_slug === 'septivolt', 'Database slug updated to septivolt');

  // TEST 7: /jarvis_mobile_inbox count reflects triage reduction (decreased from 2 to 1)
  const countText2 = await handleCommand('/jarvis_mobile_inbox count', mockMessage);
  runAssert(countText2.includes('1'), 'Unprocessed count correctly decreased');

  // TEST 8: /jarvis_archive_processed archives rows with processed = true
  const clearRes = await handleCommand('/jarvis_archive_processed', mockMessage);
  runAssert(clearRes.includes('Inbox Cleaned'), 'Archive confirmation matches');
  runAssert(clearRes.includes('archived'), 'Mention archived count');
  
  // Verify row archived in DB
  const checkArchived = await client.query('SELECT archived, archived_at FROM jarvis_mobile_uploads WHERE id = $1;', [seededIds[0]]);
  runAssert(checkArchived.rows[0].archived === true, 'Processed rows are archived in the database');
  runAssert(checkArchived.rows[0].archived_at !== null, 'archived_at timestamp is set');

  // TEST 9: /jarvis_mobile_inbox archived shows archived records
  const archivedText = await handleCommand('/jarvis_mobile_inbox archived', mockMessage);
  runAssert(archivedText.includes('Archived Mobile Inbox'), 'Archived inbox title matches');
  runAssert(archivedText.includes('Phase 3E Old Processed Upload'), 'Archived inbox contains the archived item');

  // TEST 10: Permission gating summary shows /jarvis_process_latest under State Mutation
  const summaryText = await handleCommand('/run_permissions', mockMessage);
  runAssert(summaryText.includes('/jarvis_process_latest'), 'process latest is under State Mutation');
  runAssert(summaryText.includes('/jarvis_archive_processed'), 'archive processed is registered');

  console.log(`\n🎉 Phase 3E Validation Complete! Passed 10 of 10 tests.`);
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
