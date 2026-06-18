/**
 * Jarvis Phase 4B: Local Inventory Review UX Validation Suite
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
const TEST_DIR = path.resolve(__dirname, 'temp_test_inventory_4b').replace(/\\/g, '/');

let client;
let seededFolderId;

async function setup() {
  console.log('Setting up Phase 4B validation...');
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

  // Write files with controlled sizes to test size sorting
  // 1. septivolt_plan.txt (50 bytes)
  fs.writeFileSync(path.join(TEST_DIR, 'septivolt_plan.txt'), 'A'.repeat(50));
  // 2. g-g-cleaning-receipt.pdf (500 bytes)
  fs.writeFileSync(path.join(TEST_DIR, 'g-g-cleaning-receipt.pdf'), 'B'.repeat(500));
  // 3. cresca-os-architecture.md (1000 bytes)
  fs.writeFileSync(path.join(TEST_DIR, 'cresca-os-architecture.md'), 'C'.repeat(1000));
  // 4. unmatched_script.js (150 bytes)
  fs.writeFileSync(path.join(TEST_DIR, 'unmatched_script.js'), 'D'.repeat(150));
  // 5. another_unmatched.txt (250 bytes)
  fs.writeFileSync(path.join(TEST_DIR, 'another_unmatched.txt'), 'E'.repeat(250));

  // Clean up any stale test folders from DB
  await client.query("DELETE FROM jarvis_local_folders WHERE folder_path = $1 OR folder_path LIKE '%temp_test_inventory_4b';", [TEST_DIR]);

  // Seed and approve folder directly
  const folderRes = await client.query(
    `INSERT INTO jarvis_local_folders (folder_path, approved)
     VALUES ($1, true)
     RETURNING id;`,
    [TEST_DIR]
  );
  seededFolderId = folderRes.rows[0].id;

  // Run initial scan to populate index
  await handleCommand('/jarvis_scan', { chat: { id: 12345 }, from: { id: 12345 } });
}

async function cleanup() {
  console.log('\nCleaning up Phase 4B validation resources...');
  
  if (client) {
    try {
      await client.query("DELETE FROM jarvis_local_folders WHERE folder_path = $1 OR folder_path LIKE '%temp_test_inventory_4b';", [TEST_DIR]);
      await client.end();
    } catch (err) {
      console.error('[Cleanup DB Error]', err.message);
    }
  }

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

  // TEST 1: /jarvis_folders pending returns empty when none are pending
  const pendingRes = await handleCommand('/jarvis_folders pending', mockMessage);
  runAssert(pendingRes.includes('No matching folders'), 'Pending lists no folders');

  // TEST 2: /jarvis_folders approved lists the approved test folder
  const approvedRes = await handleCommand('/jarvis_folders approved', mockMessage);
  runAssert(approvedRes.includes('Approved Local Folders'), 'Approved title matches');
  runAssert(approvedRes.includes(TEST_DIR), 'Lists the approved test folder');

  // TEST 3: /jarvis_files recent returns recent indexed files
  const recentRes = await handleCommand('/jarvis_files recent', mockMessage);
  runAssert(recentRes.includes('Recent Indexed Files'), 'Recent title matches');
  runAssert(recentRes.includes('cresca-os-architecture.md'), 'Lists MD file');
  runAssert(recentRes.includes('g-g-cleaning-receipt.pdf'), 'Lists PDF file');

  // TEST 4: /jarvis_files large returns files sorted by size (MD -> PDF -> txt -> js -> txt)
  const largeRes = await handleCommand('/jarvis_files large', mockMessage);
  runAssert(largeRes.includes('Largest Indexed Files'), 'Large title matches');
  
  // Verify size order: 1000 KB (actually bytes in formatting, e.g. 1.0 KB, 0.5 KB, etc.)
  const idxMD = largeRes.indexOf('cresca-os-architecture.md');
  const idxPDF = largeRes.indexOf('g-g-cleaning-receipt.pdf');
  const idxTxtUnmatched = largeRes.indexOf('another_unmatched.txt');
  const idxJs = largeRes.indexOf('unmatched_script.js');
  const idxTxtProj = largeRes.indexOf('septivolt_plan.txt');

  runAssert(idxMD < idxPDF, 'MD (1000 bytes) is listed before PDF (500 bytes)');
  runAssert(idxPDF < idxTxtUnmatched, 'PDF (500 bytes) is listed before txt (250 bytes)');
  runAssert(idxTxtUnmatched < idxJs, 'txt (250 bytes) is listed before js (150 bytes)');
  runAssert(idxJs < idxTxtProj, 'js (150 bytes) is listed before txt (50 bytes)');

  // TEST 5: /jarvis_files by_type pdf returns only PDF files
  const pdfRes = await handleCommand('/jarvis_files by_type pdf', mockMessage);
  runAssert(pdfRes.includes('Indexed Files of Type: pdf'), 'PDF type title matches');
  runAssert(pdfRes.includes('g-g-cleaning-receipt.pdf'), 'Lists PDF file');
  runAssert(!pdfRes.includes('septivolt_plan.txt'), 'Excludes TXT plan');
  runAssert(!pdfRes.includes('cresca-os-architecture.md'), 'Excludes MD file');

  // TEST 6: /jarvis_files unmatched lists only files not mapped to active project slugs
  const unmatchedRes = await handleCommand('/jarvis_files unmatched', mockMessage);
  runAssert(unmatchedRes.includes('Unmatched Indexed Files'), 'Unmatched title matches');
  runAssert(unmatchedRes.includes('unmatched_script.js'), 'Contains unmatched script file');
  runAssert(unmatchedRes.includes('another_unmatched.txt'), 'Contains unmatched txt file');
  runAssert(!unmatchedRes.includes('septivolt_plan.txt'), 'Excludes matched septivolt plan');
  runAssert(!unmatchedRes.includes('g-g-cleaning-receipt.pdf'), 'Excludes matched g-g-cleaning receipt');

  // TEST 7: /jarvis_files project septivolt lists only septivolt files
  const projRes = await handleCommand('/jarvis_files project septivolt', mockMessage);
  runAssert(projRes.includes('Indexed Files for Project: septivolt'), 'Project title matches');
  runAssert(projRes.includes('septivolt_plan.txt'), 'Lists septivolt plan');
  runAssert(!projRes.includes('g-g-cleaning-receipt.pdf'), 'Excludes cleaning file');

  // TEST 8: /jarvis_files septivolt (legacy compatibility fallback) lists septivolt files
  const fallbackRes = await handleCommand('/jarvis_files septivolt', mockMessage);
  runAssert(fallbackRes.includes('Indexed Files for Project: septivolt'), 'Fallback project title matches');
  runAssert(fallbackRes.includes('septivolt_plan.txt'), 'Lists septivolt plan in fallback');

  // TEST 9: Schema check: Verify no raw content columns exist in database index
  const columnsRes = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'jarvis_local_file_index';"
  );
  const columnNames = columnsRes.rows.map(c => c.column_name);
  runAssert(!columnNames.includes('file_content'), 'Schema: no file_content column exists');
  runAssert(!columnNames.includes('body'), 'Schema: no body column exists');
  runAssert(!columnNames.includes('content'), 'Schema: no content column exists');

  // TEST 10: Static check: Verify no fs.readFile or fs.readFileSync calls in local-inventory.js
  const localInventoryCode = fs.readFileSync(path.resolve(__dirname, '../jarvis/local-inventory.js'), 'utf8');
  runAssert(!localInventoryCode.includes('readFile') && !localInventoryCode.includes('readFileSync'), 'Static: local-inventory.js does not read file contents');

  console.log(`\n🎉 Phase 4B Validation Complete! Passed 10 of 10 tests.`);
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
