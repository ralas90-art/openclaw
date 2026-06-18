/**
 * Jarvis Phase 4: Local File Inventory Validation Suite
 */

// Set up environment variables at the very top before requiring modules
process.env.TELEGRAM_ALLOWED_RUNTIME_CHAT_IDS = '12345';
process.env.TELEGRAM_ALLOWED_USER_IDS = '12345';
process.env.OPENCLAW_ROLE_SUPER_ADMIN_CHAT_IDS = '12345';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { Client } = require('pg');
const { handleCommand } = require('../interfaces/telegram/handlers');

const DB_URL = process.env.DATABASE_URL;
const TEST_DIR = path.resolve(__dirname, 'temp_test_inventory').replace(/\\/g, '/');

let client;
let seededFolderId;

async function setup() {
  console.log('Setting up Phase 4 validation...');
  if (!DB_URL) {
    console.error('Error: DATABASE_URL is not set.');
    process.exit(1);
  }

  client = new Client({ connectionString: DB_URL });
  await client.connect();

  // Create temporary directory and files
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR);
  }

  // Write temporary files for scanning
  fs.writeFileSync(path.join(TEST_DIR, 'septivolt_plan.txt'), 'Dummy project plan.');
  fs.writeFileSync(path.join(TEST_DIR, 'random_notes.md'), 'General workspace notes.');
  fs.writeFileSync(path.join(TEST_DIR, 'g-g-cleaning-invoice.pdf'), 'Dummy PDF invoice.');

  // Clean up any stale test folders from DB
  await client.query("DELETE FROM jarvis_local_folders WHERE folder_path = $1 OR folder_path LIKE '%temp_test_inventory';", [TEST_DIR]);
}

async function cleanup() {
  console.log('\nCleaning up Phase 4 validation resources...');
  
  // Clean up database rows
  if (client) {
    try {
      await client.query("DELETE FROM jarvis_local_folders WHERE folder_path = $1 OR folder_path LIKE '%temp_test_inventory';", [TEST_DIR]);
      await client.end();
    } catch (err) {
      console.error('[Cleanup DB Error]', err.message);
    }
  }

  // Clean up filesystem files
  try {
    if (fs.existsSync(TEST_DIR)) {
      const files = fs.readdirSync(TEST_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(TEST_DIR, file));
      }
      fs.rmdirSync(TEST_DIR);
    }
  } catch (err) {
    console.error('[Cleanup File Error]', err.message);
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

  // TEST 1: /jarvis_add_folder handles non-existent path errors
  const errRes = await handleCommand('/jarvis_add_folder C:/this/path/does/not/exist/ever', mockMessage);
  runAssert(errRes.includes('Error:') && errRes.includes('does not exist'), 'Rejects non-existent paths');

  // TEST 2: /jarvis_add_folder registers valid directory as pending
  const addRes = await handleCommand(`/jarvis_add_folder ${TEST_DIR}`, mockMessage);
  runAssert(addRes.includes('Folder Registered'), 'Successfully registers folder');
  runAssert(addRes.includes('Pending Approval'), 'Default status is pending');
  
  // Extract folder ID from output
  const matchId = addRes.match(/ID:\s*`([^`]+)`/);
  runAssert(matchId !== null, 'Finds folder ID in command response');
  seededFolderId = matchId[1];

  // Verify in database
  const checkFolder = await client.query('SELECT approved FROM jarvis_local_folders WHERE id = $1;', [seededFolderId]);
  runAssert(checkFolder.rows[0].approved === false, 'Database record approved field is false');

  // TEST 3: /jarvis_folders lists registered folders and correct status
  const listRes = await handleCommand('/jarvis_folders', mockMessage);
  runAssert(listRes.includes('Jarvis Local Folders'), 'List folders contains title');
  runAssert(listRes.includes(TEST_DIR), 'List folders contains folder path');
  runAssert(listRes.includes('Pending Approval'), 'Lists status as pending');

  // TEST 4: /jarvis_scan does not process pending directories
  const scanRes1 = await handleCommand('/jarvis_scan', mockMessage);
  runAssert(scanRes1.includes('Folders Scanned: 0'), 'Excludes pending folder from scans');

  // TEST 5: /jarvis_approve_folder updates folder status to approved
  const approveRes = await handleCommand(`/jarvis_approve_folder ${seededFolderId}`, mockMessage);
  runAssert(approveRes.includes('Folder Approved'), 'Approve command returns confirmation');
  runAssert(approveRes.includes('Approved'), 'Response shows status Approved');

  const checkApproved = await client.query('SELECT approved FROM jarvis_local_folders WHERE id = $1;', [seededFolderId]);
  runAssert(checkApproved.rows[0].approved === true, 'Database record approved field is true');

  // TEST 6: /jarvis_scan indexes files under approved directory
  const scanRes2 = await handleCommand('/jarvis_scan', mockMessage);
  runAssert(scanRes2.includes('Folders Scanned: 1'), 'Scans one approved folder');
  runAssert(scanRes2.includes('Files Indexed/Updated: 3'), 'Indexes exactly three files');

  // Verify file index table
  const checkFilesCount = await client.query('SELECT COUNT(*) FROM jarvis_local_file_index WHERE folder_id = $1;', [seededFolderId]);
  runAssert(parseInt(checkFilesCount.rows[0].count) === 3, 'Database file index table contains 3 files');

  // TEST 7: /jarvis_files displays mappings and active project suggestions
  const filesRes = await handleCommand('/jarvis_files', mockMessage);
  runAssert(filesRes.includes('Indexed Local Files & Suggestions'), 'File suggestions lists title');
  runAssert(filesRes.includes('septivolt_plan.txt'), 'Lists plan file');
  runAssert(filesRes.includes('suggested_project: `septivolt`'), 'Correctly maps septivolt slug');
  runAssert(filesRes.includes('suggested_project: `g-g-cleaning`'), 'Correctly maps g-g-cleaning slug');
  runAssert(filesRes.includes('random_notes.md'), 'Lists notes file');

  // TEST 8: /jarvis_files <project_slug> filters by project
  const filterRes = await handleCommand('/jarvis_files septivolt', mockMessage);
  runAssert(filterRes.includes('septivolt_plan.txt'), 'Contains septivolt plan file when filtered');
  runAssert(!filterRes.includes('g-g-cleaning-invoice.pdf'), 'Excludes non-septivolt file when filtered');

  // TEST 9: /jarvis_scan updates index on file additions and deletions (syncs state)
  // Delete one file, rename/add another
  fs.unlinkSync(path.join(TEST_DIR, 'septivolt_plan.txt'));
  fs.writeFileSync(path.join(TEST_DIR, 'septivolt_updated_architecture.md'), 'Updated info.');

  const scanRes3 = await handleCommand('/jarvis_scan', mockMessage);
  runAssert(scanRes3.includes('Folders Scanned: 1'), 'Sync scan reads 1 folder');
  runAssert(scanRes3.includes('Files Indexed/Updated: 3'), 'Scans current 3 files on disk');
  runAssert(scanRes3.includes('Stale File Indexes Removed: 1'), 'Successfully removes stale index entry');

  // Verify database sync count remains 3
  const finalFilesCount = await client.query('SELECT COUNT(*) FROM jarvis_local_file_index WHERE folder_id = $1;', [seededFolderId]);
  runAssert(parseInt(finalFilesCount.rows[0].count) === 3, 'Final database file index count stays synced at 3');

  // Verify new file exists in suggestions
  const filesRes2 = await handleCommand('/jarvis_files', mockMessage);
  runAssert(filesRes2.includes('septivolt_updated_architecture.md'), 'Contains new file');
  runAssert(!filesRes2.includes('septivolt_plan.txt'), 'Stale file is no longer listed');

  // TEST 10: Run permissions registry prints the new command mappings under appropriate tiers
  const permSummary = await handleCommand('/run_permissions', mockMessage);
  runAssert(permSummary.includes('/jarvis_folders'), 'jarvis_folders is registered');
  runAssert(permSummary.includes('/jarvis_add_folder'), 'jarvis_add_folder is registered');
  runAssert(permSummary.includes('/jarvis_approve_folder'), 'jarvis_approve_folder is registered');
  runAssert(permSummary.includes('/jarvis_scan'), 'jarvis_scan is registered');
  runAssert(permSummary.includes('/jarvis_files'), 'jarvis_files is registered');

  // TEST 11: Schema & Static Analysis check verifying local-inventory is metadata-only
  // 1. Schema check
  const columnsRes = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'jarvis_local_file_index';"
  );
  const columnNames = columnsRes.rows.map(c => c.column_name);
  runAssert(!columnNames.includes('file_content'), 'Schema: no file_content column exists');
  runAssert(!columnNames.includes('body'), 'Schema: no body column exists');
  runAssert(!columnNames.includes('content'), 'Schema: no content column exists');

  // 2. Static analysis of local-inventory.js
  const localInventoryCode = fs.readFileSync(path.resolve(__dirname, '../jarvis/local-inventory.js'), 'utf8');
  runAssert(!localInventoryCode.includes('readFile') && !localInventoryCode.includes('readFileSync'), 'Static: local-inventory.js does not read file contents');

  console.log(`\n🎉 Phase 4 Validation Complete! Passed 11 of 11 tests.`);
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
