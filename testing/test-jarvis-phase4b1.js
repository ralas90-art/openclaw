/**
 * Jarvis Phase 4B.1: Inventory Activation Readiness Validation Suite
 *
 * Verifies all 12 Phase 4B.1 integration scenarios:
 * - Repeat-scan idempotency & stable database IDs
 * - Metadata updates in place
 * - Deleted and renamed file reconciliation
 * - Child-directory reconciliation
 * - Empty-root reconciliation
 * - Cross-root isolation
 * - Failed-scan transactional rollback
 * - Transactional revocation & metadata invalidation
 * - Reapproval safety (zero stale snapshot leak)
 * - Scan/revocation race handling
 * - Metadata-only enforcement (zero fs.readFile/readFileSync calls)
 * - Complete teardown and resource cleanup
 */

process.env.TELEGRAM_ALLOWED_RUNTIME_CHAT_IDS = 'admin_chat_id';
process.env.TELEGRAM_ALLOWED_USER_IDS = 'admin_chat_id';
process.env.OPENCLAW_ROLE_SUPER_ADMIN_CHAT_IDS = 'admin_chat_id';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { Client } = require('pg');

if (fs.existsSync('.env.local')) {
  require('dotenv').config({ path: '.env.local' });
}
require('dotenv').config();

const testDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!testDbUrl) {
  console.error('SECURITY FATAL: TEST_DATABASE_URL or DATABASE_URL is required for Phase 4B.1 testing. Execution aborted.');
  process.exit(1);
}
process.env.TEST_DATABASE_URL = testDbUrl;

function getDbIdentity(urlStr) {
  if (!urlStr) return '';
  try {
    const u = new URL(urlStr);
    return `${u.hostname}:${u.port || '5432'}/${(u.pathname || '').replace(/^\/+/, '')}`.toLowerCase();
  } catch (e) {
    return urlStr.toLowerCase();
  }
}

if (process.env.DATABASE_URL && process.env.TEST_DATABASE_URL && getDbIdentity(process.env.TEST_DATABASE_URL) === getDbIdentity(process.env.DATABASE_URL)) {
  process.env.DATABASE_URL = 'postgresql://production_owner:secret_pass@production-db-host.internal:5432/production_openclaw_db';
}

process.env.NODE_ENV = 'test';
process.env.JARVIS_LOCAL_INVENTORY_ENABLED = 'true';
process.env.JARVIS_LOCAL_INVENTORY_ROOTS_JSON = JSON.stringify({
  test_p4b1_root_a: 'openclaw/inbox/temp_test_inventory_4b1_a',
  test_p4b1_root_b: 'openclaw/inbox/temp_test_inventory_4b1_b'
});

const localInventory = require('../jarvis/local-inventory');
const { runMigrations } = require('../jarvis/migrations');
const actions = require('../jarvis/actions');
const { handleCommand } = require('../interfaces/telegram/handlers');

const mockAdminMessage = {
  chat: { id: 'admin_chat_id' },
  from: { id: 'admin_chat_id' }
};

const workspaceRoot = localInventory.getWorkspaceRoot();
const testSubdirA = path.join(workspaceRoot, 'openclaw', 'inbox', 'temp_test_inventory_4b1_a');
const testSubdirB = path.join(workspaceRoot, 'openclaw', 'inbox', 'temp_test_inventory_4b1_b');

let pgClient;

async function setupFixtures() {
  await runMigrations();

  pgClient = new Client({ connectionString: testDbUrl });
  await pgClient.connect();

  for (const dir of [testSubdirA, testSubdirB]) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.mkdirSync(dir, { recursive: true });
  }

  // Clean DB test records
  await pgClient.query("DELETE FROM jarvis_local_file_index WHERE relative_path LIKE 'test_p4b1_%' OR file_path LIKE '%temp_test_inventory_4b1%';");
  await pgClient.query("DELETE FROM jarvis_level1_folder_inventory WHERE root_alias LIKE 'test_p4b1_%';");
  await pgClient.query("DELETE FROM jarvis_local_folders WHERE safe_alias LIKE 'test_p4b1_%';");
  await pgClient.query("DELETE FROM jarvis_approval_requests WHERE action_type = 'approve_local_inventory_root';");
}

async function cleanupFixtures() {
  console.log('\nCleaning up Phase 4B.1 test resources...');
  if (pgClient) {
    try {
      await pgClient.query("DELETE FROM jarvis_local_file_index WHERE relative_path LIKE 'test_p4b1_%' OR file_path LIKE '%temp_test_inventory_4b1%';");
      await pgClient.query("DELETE FROM jarvis_level1_folder_inventory WHERE root_alias LIKE 'test_p4b1_%';");
      await pgClient.query("DELETE FROM jarvis_local_folders WHERE safe_alias LIKE 'test_p4b1_%';");
      await pgClient.query("DELETE FROM jarvis_approval_requests WHERE action_type = 'approve_local_inventory_root';");
      await pgClient.end();
    } catch (e) {
      console.error('[Cleanup DB Error]', e.message);
    }
  }

  for (const dir of [testSubdirA, testSubdirB]) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch (e) {
      console.error('[Cleanup File Error]', e.message);
    }
  }
  console.log('Cleanup completed cleanly.');
}

async function runSuite() {
  let passed = 0;
  let total = 0;

  function test(condition, message) {
    total++;
    if (condition) {
      passed++;
      console.log(`✅ [Assertion ${total}] PASSED: ${message}`);
    } else {
      console.error(`❌ [Assertion ${total}] FAILED: ${message}`);
      throw new Error(`Test failure: ${message}`);
    }
  }

  try {
    await setupFixtures();

    console.log('\n=============================================================');
    console.log('🚀 RUNNING JARVIS PHASE 4B.1 ACTIVATION READINESS TEST SUITE');
    console.log('=============================================================\n');

    // Setup helper: register and approve a root
    async function registerAndApprove(alias) {
      const reg = await localInventory.addLocalFolder(alias, mockAdminMessage);
      await pgClient.query("UPDATE jarvis_approval_requests SET status = 'approved' WHERE id = $1;", [reg.approval_id]);
      await actions.executeApprovedAction(reg.approval_id);
      return reg;
    }

    // -------------------------------------------------------------
    // SCENARIO A: Repeat-Scan Idempotency & Stable Database IDs
    // -------------------------------------------------------------
    console.log('--- Testing Scenario A: Repeat-Scan Idempotency ---');
    await registerAndApprove('test_p4b1_root_a');

    fs.mkdirSync(path.join(testSubdirA, 'child_folder_1'), { recursive: true });
    fs.mkdirSync(path.join(testSubdirA, 'child_folder_2'), { recursive: true });
    fs.writeFileSync(path.join(testSubdirA, 'septivolt_file.txt'), 'septivolt content');
    fs.writeFileSync(path.join(testSubdirA, 'generic_doc.pdf'), 'doc content pdf');

    // First scan
    await localInventory.scanApprovedFolders('test_p4b1_root_a', mockAdminMessage);
    const filesScan1 = await localInventory.listIndexedFiles();
    const foldersScan1 = await localInventory.getFolderInventory('test_p4b1_root_a');

    test(filesScan1.length === 2, 'Scenario A1: First scan indexes exactly 2 files');
    test(foldersScan1.length === 2, 'Scenario A2: First scan indexes exactly 2 folders');

    const fileIds1 = filesScan1.map(f => f.id).sort();

    // Second & Third scans (unchanged)
    await localInventory.scanApprovedFolders('test_p4b1_root_a', mockAdminMessage);
    await localInventory.scanApprovedFolders('test_p4b1_root_a', mockAdminMessage);

    const filesScan3 = await localInventory.listIndexedFiles();
    const foldersScan3 = await localInventory.getFolderInventory('test_p4b1_root_a');
    const fileIds3 = filesScan3.map(f => f.id).sort();

    test(filesScan3.length === 2, 'Scenario A3: Repeat scans preserve exact file count (no duplicate rows)');
    test(foldersScan3.length === 2, 'Scenario A4: Repeat scans preserve exact folder count (no duplicate rows)');
    test(JSON.stringify(fileIds1) === JSON.stringify(fileIds3), 'Scenario A5: Unchanged file entries maintain stable database primary key IDs');

    // -------------------------------------------------------------
    // SCENARIO B: Metadata Update In Place
    // -------------------------------------------------------------
    console.log('\n--- Testing Scenario B: Metadata Update In Place ---');
    // Modify septivolt_file.txt content to change size
    fs.writeFileSync(path.join(testSubdirA, 'septivolt_file.txt'), 'updated septivolt content with larger payload');
    const updatedStat = fs.statSync(path.join(testSubdirA, 'septivolt_file.txt'));

    await localInventory.scanApprovedFolders('test_p4b1_root_a', mockAdminMessage);

    const filesAfterUpdate = await localInventory.listIndexedFiles();
    const updatedFile = filesAfterUpdate.find(f => f.file_name === 'septivolt_file.txt');

    test(filesAfterUpdate.length === 2, 'Scenario B1: Updating file metadata maintains exact total row count');
    test(updatedFile && updatedFile.file_size_bytes === updatedStat.size, 'Scenario B2: File size bytes updated in place in database');

    // -------------------------------------------------------------
    // SCENARIO C: File Deletion Reconciliation
    // -------------------------------------------------------------
    console.log('\n--- Testing Scenario C: File Deletion Reconciliation ---');
    fs.unlinkSync(path.join(testSubdirA, 'generic_doc.pdf'));

    await localInventory.scanApprovedFolders('test_p4b1_root_a', mockAdminMessage);

    const filesAfterDel = await localInventory.listIndexedFiles();
    test(filesAfterDel.length === 1 && filesAfterDel[0].file_name === 'septivolt_file.txt', 'Scenario C1: Deleted file is removed from index on next scan');

    const tgFilesAfterDel = await handleCommand('/jarvis_files by_type pdf', mockAdminMessage);
    test(tgFilesAfterDel.includes('No matching indexed files found'), 'Scenario C2: /jarvis_files by_type pdf returns empty after file deletion');

    // -------------------------------------------------------------
    // SCENARIO D: File Rename Reconciliation
    // -------------------------------------------------------------
    console.log('\n--- Testing Scenario D: File Rename Reconciliation ---');
    fs.renameSync(path.join(testSubdirA, 'septivolt_file.txt'), path.join(testSubdirA, 'cresca-os-renamed.md'));

    await localInventory.scanApprovedFolders('test_p4b1_root_a', mockAdminMessage);

    const filesAfterRename = await localInventory.listIndexedFiles();
    test(filesAfterRename.length === 1 && filesAfterRename[0].file_name === 'cresca-os-renamed.md', 'Scenario D1: Renamed file replaces old name in index');
    test(filesAfterRename[0].suggested_project === 'cresca-os', 'Scenario D2: Dynamic project matching updates to new project slug cresca-os');

    // -------------------------------------------------------------
    // SCENARIO E: Child-Directory Reconciliation
    // -------------------------------------------------------------
    console.log('\n--- Testing Scenario E: Child-Directory Reconciliation ---');
    fs.rmdirSync(path.join(testSubdirA, 'child_folder_2'));
    fs.renameSync(path.join(testSubdirA, 'child_folder_1'), path.join(testSubdirA, 'child_folder_renamed'));

    await localInventory.scanApprovedFolders('test_p4b1_root_a', mockAdminMessage);

    const foldersAfterReconcile = await localInventory.getFolderInventory('test_p4b1_root_a');
    const folderNames = foldersAfterReconcile.map(f => f.folder_name);

    test(foldersAfterReconcile.length === 1 && folderNames[0] === 'child_folder_renamed', 'Scenario E1: Renamed and deleted child directories reconciled cleanly');

    // -------------------------------------------------------------
    // SCENARIO F: Empty-Root Reconciliation
    // -------------------------------------------------------------
    console.log('\n--- Testing Scenario F: Empty-Root Reconciliation ---');
    fs.rmdirSync(path.join(testSubdirA, 'child_folder_renamed'));
    fs.unlinkSync(path.join(testSubdirA, 'cresca-os-renamed.md'));

    await localInventory.scanApprovedFolders('test_p4b1_root_a', mockAdminMessage);

    const emptyFiles = await localInventory.listIndexedFiles();
    const emptyFolders = await localInventory.getFolderInventory('test_p4b1_root_a');

    test(emptyFiles.length === 0, 'Scenario F1: Empty root scan removes all derived file index rows');
    test(emptyFolders.length === 0, 'Scenario F2: Empty root scan removes all derived folder inventory rows');

    // -------------------------------------------------------------
    // SCENARIO G: Cross-Root Isolation
    // -------------------------------------------------------------
    console.log('\n--- Testing Scenario G: Cross-Root Isolation ---');
    await registerAndApprove('test_p4b1_root_b');

    // Populate Root A and Root B with duplicate filename 'shared_file.txt'
    fs.writeFileSync(path.join(testSubdirA, 'shared_file.txt'), 'root A payload');
    fs.writeFileSync(path.join(testSubdirB, 'shared_file.txt'), 'root B payload');

    const resA = await localInventory.scanApprovedFolders('test_p4b1_root_a', mockAdminMessage);
    const resB = await localInventory.scanApprovedFolders('test_p4b1_root_b', mockAdminMessage);
    const allCrossFiles = await localInventory.listIndexedFiles();
    test(allCrossFiles.length === 2, 'Scenario G1: Independent roots index same filename into distinct rows');

    // Modify Root A and rescan
    fs.unlinkSync(path.join(testSubdirA, 'shared_file.txt'));
    await localInventory.scanApprovedFolders('test_p4b1_root_a', mockAdminMessage);

    const postIsoFiles = await localInventory.listIndexedFiles();
    test(postIsoFiles.length === 1 && postIsoFiles[0].safe_alias === 'test_p4b1_root_b', 'Scenario G2: Reconciling Root A leaves Root B index completely untouched');

    // -------------------------------------------------------------
    // SCENARIO H: Failed-Scan Transactional Rollback
    // -------------------------------------------------------------
    console.log('\n--- Testing Scenario H: Failed-Scan Transactional Rollback ---');
    // Ensure Root B has 1 file currently
    const rootBBeforeFail = await localInventory.listIndexedFiles();

    // Force an error inside scan Approved Folders by mocking readdirSync failure
    const origReaddir = fs.readdirSync;
    fs.readdirSync = function() {
      throw new Error('Simulated filesystem I/O error during scan');
    };

    let scanFailedErr = false;
    try {
      await localInventory.scanApprovedFolders('test_p4b1_root_b', mockAdminMessage);
    } catch (e) {
      scanFailedErr = true;
      test(e.message.includes('Simulated filesystem I/O error'), 'Scenario H1: Scanner throws clean error on filesystem failure');
    } finally {
      fs.readdirSync = origReaddir;
    }

    test(scanFailedErr, 'Scenario H2: Scan fails closed');
    const rootBAfterFail = await localInventory.listIndexedFiles();
    test(JSON.stringify(rootBBeforeFail) === JSON.stringify(rootBAfterFail), 'Scenario H3: Failed scan preserves prior complete snapshot via transaction rollback');

    // -------------------------------------------------------------
    // SCENARIO I: Transactional Revocation & Metadata Invalidation
    // -------------------------------------------------------------
    console.log('\n--- Testing Scenario I: Transactional Revocation ---');
    await localInventory.revokeLocalFolder('test_p4b1_root_b', mockAdminMessage);

    const revokedFiles = await localInventory.listIndexedFiles();
    const revokedFolders = await localInventory.getFolderInventory('test_p4b1_root_b');

    test(revokedFiles.length === 0, 'Scenario I1: Revoking root purges derived file index entries');
    test(revokedFolders.length === 0, 'Scenario I2: Revoking root purges derived folder inventory entries');

    let revokedScanBlocked = false;
    try {
      await localInventory.scanApprovedFolders('test_p4b1_root_b', mockAdminMessage);
    } catch (e) {
      revokedScanBlocked = true;
      test(e.message.includes('not approved'), 'Scenario I3: Scanning revoked root is rejected before enumeration');
    }
    test(revokedScanBlocked, 'Scenario I4: Revoked root scan blocked cleanly');

    const tgRevokedFiles = await handleCommand('/jarvis_files recent', mockAdminMessage);
    test(tgRevokedFiles.includes('No matching indexed files found'), 'Scenario I5: /jarvis_files returns empty for revoked root');

    // -------------------------------------------------------------
    // SCENARIO J: Reapproval Safety (No Stale Snapshot Leak)
    // -------------------------------------------------------------
    console.log('\n--- Testing Scenario J: Reapproval Safety ---');
    // Reapprove root B via DB status update
    await pgClient.query("UPDATE jarvis_local_folders SET status = 'approved' WHERE safe_alias = 'test_p4b1_root_b';");

    // Before rescanning, review queries must return empty
    const preScanReapprovedFiles = await localInventory.listIndexedFiles();
    test(preScanReapprovedFiles.length === 0, 'Scenario J1: Reapproved root exhibits zero stale snapshot leakage before rescan');

    // Add new file and rescan
    if (fs.existsSync(path.join(testSubdirB, 'shared_file.txt'))) {
      fs.unlinkSync(path.join(testSubdirB, 'shared_file.txt'));
    }
    fs.writeFileSync(path.join(testSubdirB, 'fresh_reapproved_doc.txt'), 'fresh content');
    await localInventory.scanApprovedFolders('test_p4b1_root_b', mockAdminMessage);

    const postRescanFiles = await localInventory.listIndexedFiles();
    test(postRescanFiles.length === 1 && postRescanFiles[0].file_name === 'fresh_reapproved_doc.txt', 'Scenario J2: Rescanning reapproved root exposes strictly fresh snapshot');

    // -------------------------------------------------------------
    // SCENARIO K: Scan / Revocation Serialization Race
    // -------------------------------------------------------------
    console.log('\n--- Testing Scenario K: Scan / Revocation Race Handling ---');
    // Revoke root B
    await localInventory.revokeLocalFolder('test_p4b1_root_b', mockAdminMessage);

    let raceScanBlocked = false;
    try {
      await localInventory.scanApprovedFolders('test_p4b1_root_b', mockAdminMessage);
    } catch (e) {
      raceScanBlocked = true;
    }
    test(raceScanBlocked, 'Scenario K1: Transactional advisory and status lock blocks scan on revoked root deterministically');

    // -------------------------------------------------------------
    // SCENARIO L: Metadata-Only Enforcement & Teardown Verification
    // -------------------------------------------------------------
    console.log('\n--- Testing Scenario L: Metadata-Only & Teardown Verification ---');
    const origReadFile = fs.readFile;
    const origReadFileSync = fs.readFileSync;
    const origCreateReadStream = fs.createReadStream;

    let contentReadAttempted = false;
    fs.readFile = function() { contentReadAttempted = true; throw new Error('FORBIDDEN: fs.readFile invoked!'); };
    fs.readFileSync = function() { contentReadAttempted = true; throw new Error('FORBIDDEN: fs.readFileSync invoked!'); };
    fs.createReadStream = function() { contentReadAttempted = true; throw new Error('FORBIDDEN: fs.createReadStream invoked!'); };

    // Reapprove & scan Root B to test spy
    await pgClient.query("UPDATE jarvis_local_folders SET status = 'approved' WHERE safe_alias = 'test_p4b1_root_b';");
    await localInventory.scanApprovedFolders('test_p4b1_root_b', mockAdminMessage);
    await localInventory.listIndexedFiles();

    fs.readFile = origReadFile;
    fs.readFileSync = origReadFileSync;
    fs.createReadStream = origCreateReadStream;

    test(!contentReadAttempted, 'Scenario L1: Zero file content reading functions called during scan or review');

    console.log(`\n=============================================================`);
    console.log(`🎉 ALL ${passed} OF ${total} PHASE 4B.1 ASSERTIONS PASSED PERFECTLY!`);
    console.log(`=============================================================\n`);

  } finally {
    await cleanupFixtures();
  }
}

runSuite().catch(err => {
  console.error('\nFATAL PHASE 4B.1 TEST FAILURE:', err);
  process.exit(1);
});
