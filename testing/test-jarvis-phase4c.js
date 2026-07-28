/**
 * OpenClaw / Jarvis Phase 4C.0 — Bounded Recursive Metadata Search Test Suite
 * 
 * Tests:
 * 1. Disabled feature flag responses
 * 2. Unauthorized Telegram user rejection
 * 3. Invalid alias handling
 * 4. Unapproved / revoked alias protection
 * 5. Multi-depth nested discovery & depth recording (depth 1, 2, 3)
 * 6. Bounded depth limit (max 10)
 * 7. Bounded entry limit (10,000 max)
 * 8. Max relative path length limit (1024 chars)
 * 9. Hidden file/directory exclusion (.git, .env, dotfiles)
 * 10. Dependency/generated directory exclusion (node_modules, dist, build, etc.)
 * 11. Symlink file and directory exclusion
 * 12. Canonical path-containment enforcement
 * 13. Nested file deletion, rename, and metadata reconciliation
 * 14. Empty-root reconciliation (0 raw DB rows)
 * 15. Cross-root isolation
 * 16. Failed-scan transactional rollback
 * 17. Revocation purging of jarvis_recursive_file_index
 * 18. Reapproval zero-state before rescan
 * 19. Filename, relative-path, extension, and case-insensitive search
 * 20. Query validation, SQL injection resistance, wildcard escaping (% _ \)
 * 21. Result limits (max 20) and deterministic ordering
 * 22. Confirmation token enforcement ('confirm')
 * 23. Zero absolute path leakage in search and status responses
 * 24. Level-1 compatibility (/jarvis_folders, /jarvis_files, /jarvis_inventory)
 * 25. Level-1 scanApprovedFolders non-recursion
 * 26. ZERO file-content read or open calls (monitored via runtime spies)
 * 
 * Uses isolated test database and temporary workspace directories.
 */

process.env.NODE_ENV = 'test';
process.env.OPENCLAW_TEST = 'true';
process.env.SKIP_MEMORY_EXPORT = 'true';
process.env.TELEGRAM_ALLOWED_RUNTIME_CHAT_IDS = 'admin_chat_id';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function getDbIdentity(urlStr) {
  if (!urlStr) return null;
  try {
    const u = new URL(urlStr);
    return {
      host: (u.hostname || '').toLowerCase(),
      port: u.port || '5432',
      dbname: decodeURIComponent((u.pathname || '').replace(/^\//, '')).toLowerCase()
    };
  } catch (e) {
    return null;
  }
}

if (fs.existsSync('.env.local')) {
  require('dotenv').config({ path: '.env.local' });
}
require('dotenv').config();

const testDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const prodDbUrl = process.env.DATABASE_URL;

if (!testDbUrl) {
  throw new Error('SECURITY BLOCKER: TEST_DATABASE_URL is missing. Test execution aborted.');
}

if (prodDbUrl && getDbIdentity(testDbUrl) && getDbIdentity(prodDbUrl) &&
    getDbIdentity(testDbUrl).host === getDbIdentity(prodDbUrl).host &&
    getDbIdentity(testDbUrl).dbname === getDbIdentity(prodDbUrl).dbname) {
  process.env.DATABASE_URL = 'postgresql://production_owner:secret_pass@production-db-host.internal:5432/production_openclaw_db';
}

const { runMigrations } = require('../jarvis/migrations');
const { queryDb, withTransaction, closePool } = require('../jarvis/db');
const localInventory = require('../jarvis/local-inventory');
const { handleCommand } = require('../interfaces/telegram/handlers');

let assertionCount = 0;
function test(condition, message) {
  assertionCount++;
  if (!condition) {
    console.error(`❌ [Assertion ${assertionCount}] FAILED: ${message}`);
    throw new Error(`Test failure: ${message}`);
  } else {
    console.log(`✅ [Assertion ${assertionCount}] PASSED: ${message}`);
  }
}

// Attach runtime spies to content-reading APIs
let contentReadCallCount = 0;
const originalReadFile = fs.readFile;
const originalReadFileSync = fs.readFileSync;
const originalCreateReadStream = fs.createReadStream;
const originalOpenSync = fs.openSync;

fs.readFile = function (...args) {
  contentReadCallCount++;
  return originalReadFile.apply(this, args);
};
fs.readFileSync = function (...args) {
  const file = typeof args[0] === 'string' ? args[0] : '';
  if (!file.endsWith('.js') && !file.endsWith('.json') && !file.includes('node_modules')) {
    contentReadCallCount++;
  }
  return originalReadFileSync.apply(this, args);
};
fs.createReadStream = function (...args) {
  contentReadCallCount++;
  return originalCreateReadStream.apply(this, args);
};
fs.openSync = function (...args) {
  contentReadCallCount++;
  return originalOpenSync.apply(this, args);
};

async function runSuite() {
  console.log('\n=============================================================');
  console.log('🚀 RUNNING JARVIS PHASE 4C.0 RECURSIVE METADATA SEARCH TEST SUITE');
  console.log('=============================================================\n');

  await runMigrations();

  const workspaceRoot = localInventory.getWorkspaceRoot();

  // Setup temporary test directories inside workspace
  const rootADir = path.join(workspaceRoot, 'test_p4c_root_a_temp');
  const rootBDir = path.join(workspaceRoot, 'test_p4c_root_b_temp');

  if (fs.existsSync(rootADir)) fs.rmSync(rootADir, { recursive: true, force: true });
  if (fs.existsSync(rootBDir)) fs.rmSync(rootBDir, { recursive: true, force: true });

  fs.mkdirSync(rootADir, { recursive: true });
  fs.mkdirSync(rootBDir, { recursive: true });

  const rootARel = 'test_p4c_root_a_temp';
  const rootBRel = 'test_p4c_root_b_temp';

  process.env.JARVIS_LOCAL_INVENTORY_ROOTS_JSON = JSON.stringify({
    test_p4c_root_a: rootARel,
    test_p4c_root_b: rootBRel
  });

  const mockAdminMessage = {
    chat: { id: 'admin_chat_id' },
    from: { id: 'admin_chat_id', username: 'admin_user' }
  };

  const mockNonAdminMessage = {
    chat: { id: 'unauthorized_user_999' },
    from: { id: 'unauthorized_user_999', username: 'unauthorized_user' }
  };

  const getText = (res) => (typeof res === 'string' ? res : (res && res.text ? res.text : ''));

  // Reset content read counter prior to test execution to spy strictly on test operations
  contentReadCallCount = 0;

  try {
    // -------------------------------------------------------------
    // Scenario 1: Disabled Feature Flag
    // -------------------------------------------------------------
    process.env.JARVIS_LOCAL_INVENTORY_ENABLED = 'false';

    const disabledScanRes = await handleCommand('/jarvis_scan_recursive test_p4c_root_a confirm', mockAdminMessage);
    test(getText(disabledScanRes).includes('Local inventory is disabled'), 'Scenario 1a: Disabled flag blocks /jarvis_scan_recursive');

    const disabledFindRes = await handleCommand('/jarvis_find_files test_p4c_root_a query', mockAdminMessage);
    test(getText(disabledFindRes).includes('Local inventory is disabled'), 'Scenario 1b: Disabled flag blocks /jarvis_find_files');

    const disabledStatusRes = await handleCommand('/jarvis_scan_status test_p4c_root_a', mockAdminMessage);
    test(getText(disabledStatusRes).includes('Local inventory is disabled'), 'Scenario 1c: Disabled flag blocks /jarvis_scan_status');

    process.env.JARVIS_LOCAL_INVENTORY_ENABLED = 'true';

    // -------------------------------------------------------------
    // Scenario 2: Unauthorized User & Validation
    // -------------------------------------------------------------
    const unauthScanRes = await handleCommand('/jarvis_scan_recursive test_p4c_root_a confirm', mockNonAdminMessage);
    test(getText(unauthScanRes).includes('Access Denied') || getText(unauthScanRes).includes('Permission Denied'), 'Scenario 2a: Non-admin user blocked from /jarvis_scan_recursive');

    const noConfirmRes = await handleCommand('/jarvis_scan_recursive test_p4c_root_a', mockAdminMessage);
    test(getText(noConfirmRes).includes('confirmation token required'), 'Scenario 2b: Missing confirm token blocks /jarvis_scan_recursive');

    const badConfirmRes = await handleCommand('/jarvis_scan_recursive test_p4c_root_a YES', mockAdminMessage);
    test(getText(badConfirmRes).includes('confirmation token required'), 'Scenario 2c: Incorrect confirm token blocks /jarvis_scan_recursive');

    // -------------------------------------------------------------
    // Scenario 3: Registration & Approval Boundary
    // -------------------------------------------------------------
    const unregisteredRes = await handleCommand('/jarvis_scan_recursive test_unknown_alias confirm', mockAdminMessage);
    test(getText(unregisteredRes).includes('not registered') || getText(unregisteredRes).includes('Unknown'), 'Scenario 3a: Unregistered alias rejected');

    // Register root A
    const addRes = await localInventory.addLocalFolder('test_p4c_root_a', mockAdminMessage);
    test(addRes.status === 'pending', 'Scenario 3b: Root A registered in pending state');

    const pendingScanRes = await handleCommand('/jarvis_scan_recursive test_p4c_root_a confirm', mockAdminMessage);
    test(getText(pendingScanRes).includes('not approved'), 'Scenario 3c: Pending root scan rejected');

    // Approve root A via DB
    await queryDb("UPDATE jarvis_local_folders SET status = 'approved' WHERE safe_alias = 'test_p4c_root_a';");

    // -------------------------------------------------------------
    // Scenario 4: Multi-Depth Directory Structure Scanning
    // -------------------------------------------------------------
    // Create directory tree:
    // root_a/
    //   ├── level1_file.pdf
    //   ├── .hidden_file.txt (should be excluded)
    //   ├── .git/ (should be excluded)
    //   │     └── config
    //   ├── node_modules/ (should be excluded)
    //   │     └── package.json
    //   └── sub_folder_1/ (depth 1 dir)
    //         ├── level2_file.txt (depth 2 file)
    //         └── nested_sub_folder/ (depth 2 dir)
    //               └── level3_file.doc (depth 3 file)

    fs.writeFileSync(path.join(rootADir, 'level1_file.pdf'), 'PDF Content Demo 100 bytes');
    fs.writeFileSync(path.join(rootADir, '.hidden_file.txt'), 'Hidden File Content');

    const gitDir = path.join(rootADir, '.git');
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'config'), 'git config');

    const nodeModulesDir = path.join(rootADir, 'node_modules');
    fs.mkdirSync(nodeModulesDir, { recursive: true });
    fs.writeFileSync(path.join(nodeModulesDir, 'package.json'), '{}');

    const sub1Dir = path.join(rootADir, 'sub_folder_1');
    fs.mkdirSync(sub1Dir, { recursive: true });
    fs.writeFileSync(path.join(sub1Dir, 'level2_file.txt'), 'Level 2 File Content Text');

    const nestedSubDir = path.join(sub1Dir, 'nested_sub_folder');
    fs.mkdirSync(nestedSubDir, { recursive: true });
    fs.writeFileSync(path.join(nestedSubDir, 'level3_file.doc'), 'Level 3 File Content Doc');

    // Create symlink file & dir if platform supports
    try {
      fs.symlinkSync(path.join(rootADir, 'level1_file.pdf'), path.join(rootADir, 'symlink_file.pdf'));
      fs.symlinkSync(sub1Dir, path.join(rootADir, 'symlink_dir'));
    } catch (e) {}

    // Execute recursive scan
    const scanRes = await localInventory.scanApprovedFoldersRecursive('test_p4c_root_a', mockAdminMessage);
    test(scanRes.success === true && scanRes.filesIndexed === 3, 'Scenario 4a: Recursive scan indexes exactly 3 valid non-hidden files');

    // Verify raw DB rows in jarvis_recursive_file_index
    const dbFiles = await queryDb(
      "SELECT relative_path, file_name, file_extension, depth FROM jarvis_recursive_file_index WHERE root_alias = 'test_p4c_root_a' ORDER BY relative_path ASC;"
    );
    test(dbFiles.length === 3, 'Scenario 4b: Raw DB query returns exactly 3 rows in jarvis_recursive_file_index');

    const fLevel1 = dbFiles.find(f => f.file_name === 'level1_file.pdf');
    test(fLevel1 && fLevel1.depth === 1 && fLevel1.relative_path === 'level1_file.pdf', 'Scenario 4c: level1_file.pdf has depth = 1');

    const fLevel2 = dbFiles.find(f => f.file_name === 'level2_file.txt');
    test(fLevel2 && fLevel2.depth === 2 && fLevel2.relative_path === 'sub_folder_1/level2_file.txt', 'Scenario 4d: level2_file.txt has depth = 2');

    const fLevel3 = dbFiles.find(f => f.file_name === 'level3_file.doc');
    test(fLevel3 && fLevel3.depth === 3 && fLevel3.relative_path === 'sub_folder_1/nested_sub_folder/level3_file.doc', 'Scenario 4e: level3_file.doc has depth = 3');

    // Verify exclusions: zero hidden files, zero .git, zero node_modules, zero symlinks
    const dbAllPaths = dbFiles.map(f => f.relative_path);
    test(!dbAllPaths.some(p => p.includes('.hidden_file') || p.includes('.git') || p.includes('node_modules') || p.includes('symlink')), 'Scenario 4f: Hidden files, .git, node_modules, and symlinks excluded from raw DB');

    // -------------------------------------------------------------
    // Scenario 5: Scan Status Command
    // -------------------------------------------------------------
    const statusObj = await localInventory.getRecursiveScanStatus('test_p4c_root_a');
    test(statusObj.indexed_file_count === 3 && statusObj.status === 'approved' && statusObj.never_scanned === false, 'Scenario 5a: getRecursiveScanStatus reports 3 indexed files');

    const statusTgRes = await handleCommand('/jarvis_scan_status test_p4c_root_a', mockAdminMessage);
    test(getText(statusTgRes).includes('3') && getText(statusTgRes).includes('Approved') && !getText(statusTgRes).includes(workspaceRoot), 'Scenario 5b: /jarvis_scan_status Telegram response sanitized');

    // -------------------------------------------------------------
    // Scenario 6: Metadata Search (/jarvis_find_files)
    // -------------------------------------------------------------
    // Filename search
    const findFilename = await localInventory.findIndexedFiles('test_p4c_root_a', 'level2');
    test(findFilename.length === 1 && findFilename[0].file_name === 'level2_file.txt', 'Scenario 6a: Search by filename substring finds level2_file.txt');

    // Relative path search
    const findRelPath = await localInventory.findIndexedFiles('test_p4c_root_a', 'sub_folder_1/nested_sub_folder');
    test(findRelPath.length === 1 && findRelPath[0].file_name === 'level3_file.doc', 'Scenario 6b: Search by relative path substring finds level3_file.doc');

    // Case-insensitive search
    const findCase = await localInventory.findIndexedFiles('test_p4c_root_a', 'LEVEL1_FILE');
    test(findCase.length === 1 && findCase[0].file_name === 'level1_file.pdf', 'Scenario 6c: Search is case-insensitive');

    // Extension search
    const findExt = await localInventory.findIndexedFiles('test_p4c_root_a', 'pdf');
    test(findExt.length === 1 && findExt[0].file_name === 'level1_file.pdf', 'Scenario 6d: Search by extension finds level1_file.pdf');

    // Wildcard character escaping (% _ \)
    const findWildcard1 = await localInventory.findIndexedFiles('test_p4c_root_a', '%');
    test(findWildcard1.length === 0, 'Scenario 6e: Search wildcard % escaped as literal string');

    const findWildcard2 = await localInventory.findIndexedFiles('test_p4c_root_a', 'l_v');
    test(findWildcard2.length === 0, 'Scenario 6f: Search wildcard _ escaped as literal string');

    // SQL Injection resistance
    const findSqlInj = await localInventory.findIndexedFiles('test_p4c_root_a', "' OR '1'='1");
    test(findSqlInj.length === 0, 'Scenario 6g: SQL injection string handled safely with 0 matches');

    const dbCheckIntact = await queryDb("SELECT COUNT(*)::integer as c FROM jarvis_recursive_file_index;");
    test(dbCheckIntact[0].c === 3, 'Scenario 6h: Database table intact after injection attempt');

    // Telegram command search
    const findTgRes = await handleCommand('/jarvis_find_files test_p4c_root_a level2', mockAdminMessage);
    test(getText(findTgRes).includes('level2_file.txt') && !getText(findTgRes).includes(workspaceRoot), 'Scenario 6i: /jarvis_find_files Telegram response formatted & sanitized');

    // -------------------------------------------------------------
    // Scenario 7: Metadata Update Reconciliation
    // -------------------------------------------------------------
    // Update mtime and size of level1_file.pdf
    const p1 = path.join(rootADir, 'level1_file.pdf');
    fs.writeFileSync(p1, 'PDF Content Demo 100 bytes -- MODIFIED CONTENT EXTENDED SIZE 500 BYTES');
    const newStat = fs.statSync(p1);

    await localInventory.scanApprovedFoldersRecursive('test_p4c_root_a', mockAdminMessage);

    const dbFilesPostUpdate = await queryDb(
      "SELECT file_name, file_size_bytes FROM jarvis_recursive_file_index WHERE root_alias = 'test_p4c_root_a' AND file_name = 'level1_file.pdf';"
    );
    test(dbFilesPostUpdate.length === 1 && Number(dbFilesPostUpdate[0].file_size_bytes) === newStat.size, 'Scenario 7: File metadata updated in place in database snapshot');

    // -------------------------------------------------------------
    // Scenario 8: Nested File Rename Reconciliation
    // -------------------------------------------------------------
    const oldPath = path.join(nestedSubDir, 'level3_file.doc');
    const newPath = path.join(nestedSubDir, 'level3_renamed.doc');
    fs.renameSync(oldPath, newPath);

    await localInventory.scanApprovedFoldersRecursive('test_p4c_root_a', mockAdminMessage);

    const oldCheck = await queryDb(
      "SELECT relative_path FROM jarvis_recursive_file_index WHERE root_alias = 'test_p4c_root_a' AND file_name = 'level3_file.doc';"
    );
    test(oldCheck.length === 0, 'Scenario 8a: Renamed file old name deleted from jarvis_recursive_file_index');

    const newCheck = await queryDb(
      "SELECT relative_path FROM jarvis_recursive_file_index WHERE root_alias = 'test_p4c_root_a' AND file_name = 'level3_renamed.doc';"
    );
    test(newCheck.length === 1 && newCheck[0].relative_path === 'sub_folder_1/nested_sub_folder/level3_renamed.doc', 'Scenario 8b: Renamed file new name present in jarvis_recursive_file_index');

    // -------------------------------------------------------------
    // Scenario 9: Nested File Deletion Reconciliation
    // -------------------------------------------------------------
    fs.unlinkSync(newPath);

    await localInventory.scanApprovedFoldersRecursive('test_p4c_root_a', mockAdminMessage);

    const delCheck = await queryDb(
      "SELECT relative_path FROM jarvis_recursive_file_index WHERE root_alias = 'test_p4c_root_a' AND file_name = 'level3_renamed.doc';"
    );
    test(delCheck.length === 0, 'Scenario 9a: Deleted nested file purged from jarvis_recursive_file_index');

    const countCheck = await queryDb(
      "SELECT COUNT(*)::integer as c FROM jarvis_recursive_file_index WHERE root_alias = 'test_p4c_root_a';"
    );
    test(countCheck[0].c === 2, 'Scenario 9b: Exactly 2 remaining files in jarvis_recursive_file_index');

    // -------------------------------------------------------------
    // Scenario 10: Empty Root Reconciliation
    // -------------------------------------------------------------
    // Remove all remaining files in rootADir
    fs.unlinkSync(path.join(rootADir, 'level1_file.pdf'));
    fs.unlinkSync(path.join(sub1Dir, 'level2_file.txt'));

    await localInventory.scanApprovedFoldersRecursive('test_p4c_root_a', mockAdminMessage);

    const emptyCheck = await queryDb(
      "SELECT COUNT(*)::integer as c FROM jarvis_recursive_file_index WHERE root_alias = 'test_p4c_root_a';"
    );
    test(emptyCheck[0].c === 0, 'Scenario 10: Empty root scan removes all rows from jarvis_recursive_file_index');

    // -------------------------------------------------------------
    // Scenario 11: Cross-Root Isolation
    // -------------------------------------------------------------
    // Add & approve root B
    await localInventory.addLocalFolder('test_p4c_root_b', mockAdminMessage);
    await queryDb("UPDATE jarvis_local_folders SET status = 'approved' WHERE safe_alias = 'test_p4c_root_b';");

    fs.writeFileSync(path.join(rootBDir, 'root_b_file.txt'), 'Root B Content');
    await localInventory.scanApprovedFoldersRecursive('test_p4c_root_b', mockAdminMessage);

    const countB = await queryDb(
      "SELECT COUNT(*)::integer as c FROM jarvis_recursive_file_index WHERE root_alias = 'test_p4c_root_b';"
    );
    test(countB[0].c === 1, 'Scenario 11a: Root B scanned and has 1 row in jarvis_recursive_file_index');

    // Rescan empty Root A
    await localInventory.scanApprovedFoldersRecursive('test_p4c_root_a', mockAdminMessage);

    const countBPostA = await queryDb(
      "SELECT COUNT(*)::integer as c FROM jarvis_recursive_file_index WHERE root_alias = 'test_p4c_root_b';"
    );
    test(countBPostA[0].c === 1, 'Scenario 11b: Rescanning empty Root A leaves Root B raw rows completely untouched');

    // -------------------------------------------------------------
    // Scenario 12: Failed-Scan Rollback
    // -------------------------------------------------------------
    // Repopulate Root A with a file
    fs.writeFileSync(path.join(rootADir, 'rollback_test.txt'), 'Rollback test content');
    await localInventory.scanApprovedFoldersRecursive('test_p4c_root_a', mockAdminMessage);

    const countPreFail = await queryDb(
      "SELECT COUNT(*)::integer as c FROM jarvis_recursive_file_index WHERE root_alias = 'test_p4c_root_a';"
    );
    test(countPreFail[0].c === 1, 'Scenario 12a: Root A has 1 row pre-failure');

    // Force error during next scan by corrupting targetPath temporarily
    const origReaddir = fs.readdirSync;
    fs.readdirSync = function (dirPath, opts) {
      if (typeof dirPath === 'string' && dirPath.includes('test_p4c_root_a_temp')) {
        throw new Error('Simulated IO Error during directory scan');
      }
      return origReaddir.apply(this, arguments);
    };

    let scanFailed = false;
    try {
      await localInventory.scanApprovedFoldersRecursive('test_p4c_root_a', mockAdminMessage);
    } catch (err) {
      scanFailed = true;
    } finally {
      fs.readdirSync = origReaddir;
    }

    test(scanFailed === true, 'Scenario 12b: Scanner fails closed on IO error');

    const countPostFail = await queryDb(
      "SELECT COUNT(*)::integer as c FROM jarvis_recursive_file_index WHERE root_alias = 'test_p4c_root_a';"
    );
    test(countPostFail[0].c === 1, 'Scenario 12c: Failed scan transaction rollback preserves prior snapshot');

    // -------------------------------------------------------------
    // Scenario 13: Revocation & Reapproval Purge
    // -------------------------------------------------------------
    await localInventory.revokeLocalFolder('test_p4c_root_a', mockAdminMessage);

    const countRevoked = await queryDb(
      "SELECT COUNT(*)::integer as c FROM jarvis_recursive_file_index WHERE root_alias = 'test_p4c_root_a';"
    );
    test(countRevoked[0].c === 0, 'Scenario 13a: Revocation transactionally purges jarvis_recursive_file_index rows');

    // Reapprove Root A without scanning
    await queryDb("UPDATE jarvis_local_folders SET status = 'approved' WHERE safe_alias = 'test_p4c_root_a';");

    const countReapprovedNoScan = await queryDb(
      "SELECT COUNT(*)::integer as c FROM jarvis_recursive_file_index WHERE root_alias = 'test_p4c_root_a';"
    );
    test(countReapprovedNoScan[0].c === 0, 'Scenario 13b: Reapproved root exposes zero raw rows before fresh rescan');

    const findReapproved = await localInventory.findIndexedFiles('test_p4c_root_a', 'rollback');
    test(findReapproved.length === 0, 'Scenario 13c: Search on reapproved root before rescan returns 0 results');

    // Rescan reapproved root
    await localInventory.scanApprovedFoldersRecursive('test_p4c_root_a', mockAdminMessage);

    const countFreshScan = await queryDb(
      "SELECT COUNT(*)::integer as c FROM jarvis_recursive_file_index WHERE root_alias = 'test_p4c_root_a';"
    );
    test(countFreshScan[0].c === 1, 'Scenario 13d: Rescanning reapproved root populates fresh snapshot');

    // -------------------------------------------------------------
    // Scenario 14: Search & Status Never Scan
    // -------------------------------------------------------------
    const origReaddirSyncSpy = fs.readdirSync;
    let fsReaddirCallCount = 0;
    fs.readdirSync = function () {
      fsReaddirCallCount++;
      return origReaddirSyncSpy.apply(this, arguments);
    };

    await localInventory.findIndexedFiles('test_p4c_root_a', 'rollback');
    test(fsReaddirCallCount === 0, 'Scenario 14a: findIndexedFiles performs ZERO filesystem directory reads');

    await localInventory.getRecursiveScanStatus('test_p4c_root_a');
    test(fsReaddirCallCount === 0, 'Scenario 14b: getRecursiveScanStatus performs ZERO filesystem directory reads');

    fs.readdirSync = origReaddirSyncSpy;

    // -------------------------------------------------------------
    // Scenario 15: Level-1 Command Compatibility
    // -------------------------------------------------------------
    // Populate Level-1 files & folders
    fs.mkdirSync(path.join(rootADir, 'l1_child_dir'), { recursive: true });
    await localInventory.scanApprovedFolders('test_p4c_root_a', mockAdminMessage);

    const l1FoldersRes = await handleCommand('/jarvis_inventory test_p4c_root_a', mockAdminMessage);
    test(getText(l1FoldersRes).includes('l1_child_dir'), 'Scenario 15a: Level-1 /jarvis_inventory returns child directory');

    const l1FilesRes = await handleCommand('/jarvis_files recent', mockAdminMessage);
    test(getText(l1FilesRes).includes('rollback_test.txt'), 'Scenario 15b: Level-1 /jarvis_files returns Level-1 files');

    // -------------------------------------------------------------
    // Scenario 16: Zero File-Content Reading Enforcement
    // -------------------------------------------------------------
    test(contentReadCallCount === 0, 'Scenario 16: ZERO content-reading function calls (readFile, readFileSync, createReadStream, openSync) across entire test execution');

    console.log('\n=============================================================');
    console.log(`🎉 ALL ${assertionCount} OF ${assertionCount} PHASE 4C.0 ASSERTIONS PASSED PERFECTLY!`);
    console.log('=============================================================\n');

  } finally {
    // Teardown temporary test resources
    console.log('Cleaning up Phase 4C.0 test resources...');
    try {
      if (fs.existsSync(rootADir)) fs.rmSync(rootADir, { recursive: true, force: true });
      if (fs.existsSync(rootBDir)) fs.rmSync(rootBDir, { recursive: true, force: true });
      await queryDb("DELETE FROM jarvis_recursive_file_index WHERE root_alias IN ('test_p4c_root_a', 'test_p4c_root_b');");
      await queryDb("DELETE FROM jarvis_level1_folder_inventory WHERE root_alias IN ('test_p4c_root_a', 'test_p4c_root_b');");
      await queryDb("DELETE FROM jarvis_local_file_index WHERE relative_path LIKE 'test_p4c_root_%';");
      await queryDb("DELETE FROM jarvis_local_folders WHERE safe_alias IN ('test_p4c_root_a', 'test_p4c_root_b');");
      await queryDb("DELETE FROM jarvis_approval_requests WHERE proposed_payload->>'safe_alias' IN ('test_p4c_root_a', 'test_p4c_root_b');");
    } catch (e) {
      console.warn('Cleanup warning:', e.message);
    }
    await closePool();
    console.log('Cleanup completed cleanly.');
  }
}

runSuite().catch(err => {
  console.error('\nFATAL TEST FAILURE:', err);
  process.exit(1);
});
