/**
 * Jarvis Phase 3B.5: Mobile Inbox Triage Commands Validation Suite
 */

// Set up environment variables at the very top before requiring modules
process.env.TELEGRAM_ALLOWED_RUNTIME_CHAT_IDS = '12345';
process.env.TELEGRAM_ALLOWED_USER_IDS = '12345';
process.env.OPENCLAW_ROLE_SUPER_ADMIN_CHAT_IDS = '12345';

const { Client } = require('pg');
const { handleCommand } = require('../interfaces/telegram/handlers');

const DB_URL = process.env.DATABASE_URL;
const TEST_CHAT_ID = '12345';

let client;
let recordA = null;
let recordB = null;

async function setup() {
  console.log('Setting up Phase 3B.5 validation...');
  if (!DB_URL) {
    console.error('Error: DATABASE_URL is not set.');
    process.exit(1);
  }
  
  client = new Client({ connectionString: DB_URL });
  await client.connect();
  
  // Clean up any old test records just in case
  await client.query("DELETE FROM jarvis_mobile_uploads WHERE text_content LIKE 'Phase 3B.5 Test Note%';");
  
  // Seed two temporary mobile uploads
  console.log('[Setup] Seeding test mobile uploads...');
  const resA = await client.query(
    `INSERT INTO jarvis_mobile_uploads (intake_source, task_type, text_content, processed)
     VALUES ('shortcut', 'text', 'Phase 3B.5 Test Note A - Unprocessed note', false)
     RETURNING *;`
  );
  recordA = resA.rows[0];
  
  const resB = await client.query(
    `INSERT INTO jarvis_mobile_uploads (intake_source, task_type, text_content, processed)
     VALUES ('shortcut', 'text', 'Phase 3B.5 Test Note B - Assign to project', false)
     RETURNING *;`
  );
  recordB = resB.rows[0];
  
  console.log(`[Setup] Seeded Record A ID: ${recordA.id}, Record B ID: ${recordB.id}`);
}

async function cleanup() {
  console.log('\nCleaning up Phase 3B.5 validation resources...');
  if (client) {
    try {
      await client.query("DELETE FROM jarvis_mobile_uploads WHERE text_content LIKE 'Phase 3B.5 Test Note%';");
      await client.end();
    } catch (err) {
      console.error('[Cleanup Error]', err.message);
    }
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
    chat: { id: TEST_CHAT_ID },
    from: { id: TEST_CHAT_ID }
  };

  try {
    // 1. Test /jarvis_mobile_inbox shows unprocessed seeded notes
    console.log('\n[Test 1] Checking default /jarvis_mobile_inbox...');
    const inboxText = await handleCommand('/jarvis_mobile_inbox', mockMessage);
    runAssert(inboxText.includes('Unprocessed Mobile Inbox'), 'Inbox title is correct');
    runAssert(inboxText.includes(recordA.id), 'Record A ID is in output');
    runAssert(inboxText.includes(recordB.id), 'Record B ID is in output');

    // 2. Test /jarvis_mark_processed error handling (invalid UUID)
    console.log('\n[Test 2] Checking /jarvis_mark_processed invalid UUID...');
    const errText1 = await handleCommand('/jarvis_mark_processed invalid-uuid-format', mockMessage);
    runAssert(errText1.includes('❌ Error:'), 'Returns error indicator');
    runAssert(errText1.includes('Must be a valid UUID'), 'Returns UUID format error message');

    // 3. Test /jarvis_mark_processed error handling (non-existent record)
    console.log('\n[Test 3] Checking /jarvis_mark_processed non-existent UUID...');
    const nonExistentUuid = '00000000-0000-0000-0000-000000000000';
    const errText2 = await handleCommand(`/jarvis_mark_processed ${nonExistentUuid}`, mockMessage);
    runAssert(errText2.includes('❌ Error:'), 'Returns error indicator');
    runAssert(errText2.includes('Mobile upload record not found'), 'Returns not found error message');

    // 4. Test /jarvis_mark_processed successfully updates Record A
    console.log(`\n[Test 4] Checking /jarvis_mark_processed for ID ${recordA.id}...`);
    const successText1 = await handleCommand(`/jarvis_mark_processed ${recordA.id}`, mockMessage);
    runAssert(successText1.includes('✅'), 'Returns success indicator');
    runAssert(successText1.includes('marked as processed'), 'Returns processed confirmation');

    // 5. Test Record A state in database
    console.log('\n[Test 5] Verifying Record A state in database...');
    const dbA = await client.query('SELECT * FROM jarvis_mobile_uploads WHERE id = $1;', [recordA.id]);
    runAssert(dbA.rows[0].processed === true, 'Record A processed is now true');

    // 6. Test default inbox no longer displays Record A
    console.log('\n[Test 6] Verifying processed note does not appear in default inbox...');
    const inboxTextAfter = await handleCommand('/jarvis_mobile_inbox', mockMessage);
    runAssert(!inboxTextAfter.includes(recordA.id), 'Record A ID is no longer in default inbox');
    runAssert(inboxTextAfter.includes(recordB.id), 'Record B ID is still in default inbox');

    // 7. Test /jarvis_mobile_inbox processed filter
    console.log('\n[Test 7] Checking /jarvis_mobile_inbox processed...');
    const inboxProcessedText = await handleCommand('/jarvis_mobile_inbox processed', mockMessage);
    runAssert(inboxProcessedText.includes('Processed Mobile Inbox'), 'Inbox title is correct for processed filter');
    runAssert(inboxProcessedText.includes(recordA.id), 'Record A ID is in processed inbox');
    runAssert(!inboxProcessedText.includes(recordB.id), 'Record B ID is not in processed inbox');

    // 8. Test /jarvis_mobile_inbox all filter
    console.log('\n[Test 8] Checking /jarvis_mobile_inbox all...');
    const inboxAllText = await handleCommand('/jarvis_mobile_inbox all', mockMessage);
    runAssert(inboxAllText.includes('All Mobile Inbox'), 'Inbox title is correct for all filter');
    runAssert(inboxAllText.includes(recordA.id), 'Record A ID is in all inbox');
    runAssert(inboxAllText.includes(recordB.id), 'Record B ID is in all inbox');

    // 9. Test /jarvis_process_inbox invalid project slug
    console.log('\n[Test 9] Checking /jarvis_process_inbox invalid project_slug...');
    const errText3 = await handleCommand(`/jarvis_process_inbox ${recordB.id} non-existent-project`, mockMessage);
    runAssert(errText3.includes('❌ Error:'), 'Returns error indicator');
    runAssert(errText3.includes('Invalid project slug'), 'Returns project slug error message');

    // 10. Test /jarvis_process_inbox successfully assigns Record B to project septivolt
    console.log(`\n[Test 10] Checking /jarvis_process_inbox for Record B to septivolt...`);
    const successText2 = await handleCommand(`/jarvis_process_inbox ${recordB.id} septivolt`, mockMessage);
    runAssert(successText2.includes('✅'), 'Returns success indicator');
    runAssert(successText2.includes('Mobile Upload Processed & Assigned'), 'Returns assigned confirmation card');
    runAssert(successText2.includes('septivolt'), 'Confirmation card shows assigned project slug');

    // 11. Test Record B state in database
    console.log('\n[Test 11] Verifying Record B state in database...');
    const dbB = await client.query('SELECT * FROM jarvis_mobile_uploads WHERE id = $1;', [recordB.id]);
    runAssert(dbB.rows[0].processed === true, 'Record B processed is now true');
    runAssert(dbB.rows[0].project_slug === 'septivolt', 'Record B project_slug is now septivolt');

    // 12. Test /jarvis_mobile_inbox <project_slug> filter
    console.log('\n[Test 12] Checking /jarvis_mobile_inbox septivolt...');
    const inboxProjectText = await handleCommand('/jarvis_mobile_inbox septivolt', mockMessage);
    runAssert(inboxProjectText.includes('Mobile Inbox for Project: septivolt'), 'Inbox title is correct for project slug filter');
    runAssert(inboxProjectText.includes(recordB.id), 'Record B ID is in project inbox');
    runAssert(!inboxProjectText.includes(recordA.id), 'Record A ID is not in project inbox');

    console.log(`\n🎉 Phase 3B.5 Validation Complete! Passed 12 of 12 tests.`);
  } catch (err) {
    console.error('Test execution failed:', err.message);
    process.exit(1);
  }
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
