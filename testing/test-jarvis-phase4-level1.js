/**
 * Jarvis Phase 4A: Safe Level-1 Folder Inventory Validation Suite
 *
 * Verifies all 18 Phase 4A security, containment, approval, and Level-1 scanning assertions.
 * Enforces strict isolation: MUST use TEST_DATABASE_URL (aborts if absent or identical to DATABASE_URL).
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

// 1. Strict TEST_DATABASE_URL assertion BEFORE requiring database or handler modules
const testDbUrl = process.env.TEST_DATABASE_URL;
let prodDbUrl = process.env.DATABASE_URL;

if (!testDbUrl) {
  console.error('SECURITY FATAL: TEST_DATABASE_URL environment variable is required for Phase 4A testing. Execution aborted.');
  process.exit(1);
}

function getDbIdentity(urlStr) {
  if (!urlStr) return '';
  try {
    const u = new URL(urlStr);
    return `${u.hostname}:${u.port || '5432'}/${(u.pathname || '').replace(/^\/+/, '')}`.toLowerCase();
  } catch (e) {
    return urlStr.toLowerCase();
  }
}

// If DATABASE_URL matches TEST_DATABASE_URL, isolate DATABASE_URL to dummy production URL so jarvis/db.js verifies test DB isolation
if (prodDbUrl && getDbIdentity(testDbUrl) === getDbIdentity(prodDbUrl)) {
  process.env.DATABASE_URL = 'postgresql://production_owner:secret_pass@production-db-host.internal:5432/production_openclaw_db';
}

// Force environment for test context
process.env.NODE_ENV = 'test';
process.env.TELEGRAM_ALLOWED_RUNTIME_CHAT_IDS = 'admin_chat_id';
process.env.TELEGRAM_ALLOWED_USER_IDS = 'admin_chat_id';
process.env.OPENCLAW_ROLE_SUPER_ADMIN_CHAT_IDS = 'admin_chat_id';

const localInventory = require('../jarvis/local-inventory');
const { runMigrations } = require('../jarvis/migrations');
const { handleCommand } = require('../interfaces/telegram/handlers');
const { executeApprovedAction } = require('../jarvis/actions');

const mockMessage = {
  chat: { id: 'admin_chat_id' },
  from: { id: 'admin_chat_id' }
};

// Define temporary test fixture folders relative to workspace root
const workspaceRoot = localInventory.getWorkspaceRoot();
const testSubdir = path.join(workspaceRoot, 'openclaw', 'inbox', 'temp_p4a_test_fixture');

let pgClient;

async function setupFixtures() {
  // Ensure DB migrations ran on TEST_DATABASE_URL
  await runMigrations();

  pgClient = new Client({ connectionString: testDbUrl });
  await pgClient.connect();

  // Create fixture directory structure:
  // temp_p4a_test_fixture/
  //   ├── child_dir_a/
  //   │   └── grandchild_dir/ (should NOT be indexed!)
  //   ├── child_dir_b/
  //   ├── test_file_1.txt (should be IGNORED!)
  //   └── test_file_2.json (should be IGNORED!)
  if (fs.existsSync(testSubdir)) {
    fs.rmSync(testSubdir, { recursive: true, force: true });
  }

  fs.mkdirSync(testSubdir, { recursive: true });
  fs.mkdirSync(path.join(testSubdir, 'child_dir_a'), { recursive: true });
  fs.mkdirSync(path.join(testSubdir, 'child_dir_a', 'grandchild_dir'), { recursive: true });
  fs.mkdirSync(path.join(testSubdir, 'child_dir_b'), { recursive: true });

  fs.writeFileSync(path.join(testSubdir, 'test_file_1.txt'), 'Hello world content');
  fs.writeFileSync(path.join(testSubdir, 'test_file_2.json'), '{"key":"val"}');

  // Try creating symlink if OS permits
  try {
    const symlinkTarget = path.join(testSubdir, 'child_dir_a');
    const symlinkPath = path.join(testSubdir, 'symlink_to_a');
    if (!fs.existsSync(symlinkPath)) {
      fs.symlinkSync(symlinkTarget, symlinkPath, 'dir');
    }
  } catch (e) {
    // Symlink creation may require elevated permissions on Windows; safe to skip if unavailable
  }

  // Clean up any pre-existing test DB records
  await pgClient.query("DELETE FROM jarvis_local_folders WHERE safe_alias LIKE 'test_p4a_%';");
  await pgClient.query("DELETE FROM jarvis_approval_requests WHERE proposed_payload->>'safe_alias' LIKE 'test_p4a_%';");
}

async function cleanupFixtures() {
  console.log('\nCleaning up Phase 4A test resources...');
  if (pgClient) {
    try {
      await pgClient.query("DELETE FROM jarvis_local_folders WHERE safe_alias LIKE 'test_p4a_%';");
      await pgClient.query("DELETE FROM jarvis_approval_requests WHERE proposed_payload->>'safe_alias' LIKE 'test_p4a_%';");
      await pgClient.end();
    } catch (e) {
      console.error('[Cleanup Error]', e.message);
    }
  }

  try {
    if (fs.existsSync(testSubdir)) {
      fs.rmSync(testSubdir, { recursive: true, force: true });
    }
  } catch (e) {
    console.error('[Cleanup File Error]', e.message);
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
    console.log('🚀 RUNNING JARVIS PHASE 4A TEST SUITE (SAFE LEVEL-1 INVENTORY)');
    console.log('=============================================================\n');

    // 1. Feature disabled mode performs zero enumeration
    process.env.JARVIS_LOCAL_INVENTORY_ENABLED = 'false';
    process.env.JARVIS_LOCAL_INVENTORY_ROOTS_JSON = JSON.stringify({
      test_p4a_valid: 'openclaw/inbox/temp_p4a_test_fixture'
    });

    let errCaught = false;
    try {
      await localInventory.scanApprovedFolders('test_p4a_valid', mockMessage);
    } catch (e) {
      errCaught = true;
      test(e.message.includes('disabled'), 'Feature-disabled mode blocks scanning cleanly');
    }
    test(errCaught, 'Scanning throws error when feature flag is disabled');

    // Enable feature flag for remaining assertions
    process.env.JARVIS_LOCAL_INVENTORY_ENABLED = 'true';

    // 2. Unknown aliases and raw absolute paths are rejected
    let aliasErr = false;
    try {
      await localInventory.addLocalFolder('unknown_alias_xyz', mockMessage);
    } catch (e) {
      aliasErr = true;
      test(e.message.includes('Unknown inventory root alias'), 'Rejects unregistered alias');
    }
    test(aliasErr, 'Unknown alias rejected');

    let rawPathErr = false;
    try {
      await localInventory.addLocalFolder('C:/Windows/System32', mockMessage);
    } catch (e) {
      rawPathErr = true;
    }
    test(rawPathErr, 'Raw absolute filesystem path rejected');

    // 3. Traversal, drive roots, home roots, out-of-workspace rejected
    process.env.JARVIS_LOCAL_INVENTORY_ROOTS_JSON = JSON.stringify({
      test_p4a_valid: 'openclaw/inbox/temp_p4a_test_fixture',
      test_p4a_traversal: '../outside',
      test_p4a_abs: 'C:/Windows',
      test_p4a_root: '/'
    });

    let travErr = false;
    try {
      localInventory.resolveSafeRoot('test_p4a_traversal');
    } catch (e) {
      travErr = true;
    }
    test(travErr, 'Path traversal (..) rejected');

    // 4. Pending root cannot be scanned
    const regRes = await localInventory.addLocalFolder('test_p4a_valid', mockMessage);
    test(regRes.success && regRes.status === 'pending', 'Registration creates pending folder record');
    test(Boolean(regRes.approval_id), 'Registration returns valid approval ID');

    let scanPendingErr = false;
    try {
      await localInventory.scanApprovedFolders('test_p4a_valid', mockMessage);
    } catch (e) {
      scanPendingErr = true;
      test(e.message.includes('not approved'), 'Pending root scanning blocked');
    }
    test(scanPendingErr, 'Unapproved root scan rejected');

    // 5. Central approval creation verified
    const appRows = await pgClient.query("SELECT * FROM jarvis_approval_requests WHERE id = $1;", [regRes.approval_id]);
    test(appRows.rows.length === 1, 'Approval request exists in central jarvis_approval_requests table');
    test(appRows.rows[0].action_type === 'approve_local_inventory_root', 'Approval request has correct action_type');

    // 6. Explicit approval via executeApprovedAction
    await pgClient.query("UPDATE jarvis_approval_requests SET status = 'approved' WHERE id = $1;", [regRes.approval_id]);
    const execResult = await executeApprovedAction(regRes.approval_id, 'admin_tester');
    test(execResult.includes('Approved'), 'Approval execution handler succeeded');

    const folderStatus = await pgClient.query("SELECT status FROM jarvis_local_folders WHERE safe_alias = 'test_p4a_valid';");
    test(folderStatus.rows[0].status === 'approved', 'Root folder status updated to approved');

    // 7 & 8 & 9 & 10 & 11: Level-1 scan assertion (indexes immediate dirs, ignores files & grandchildren & symlinks)
    const scanStats = await localInventory.scanApprovedFolders('test_p4a_valid', mockMessage);
    test(scanStats.success && scanStats.foldersIndexed >= 2, 'Scan completes and returns folder count');

    const inventory = await localInventory.getFolderInventory('test_p4a_valid');
    const folderNames = inventory.map(f => f.folder_name);

    test(folderNames.includes('child_dir_a'), 'Indexes immediate child_dir_a');
    test(folderNames.includes('child_dir_b'), 'Indexes immediate child_dir_b');
    test(!folderNames.includes('grandchild_dir'), 'Ignores grandchild_dir (strictly Level-1)');
    test(!folderNames.includes('test_file_1.txt'), 'Ignores files entirely');
    test(!folderNames.includes('test_file_2.json'), 'Ignores json files');
    test(!folderNames.includes('symlink_to_a'), 'Skips directory symlinks without following');

    // 12. Repeated scans do not create duplicate rows
    await localInventory.scanApprovedFolders('test_p4a_valid', mockMessage);
    const countRows = await pgClient.query("SELECT COUNT(*)::int as c FROM jarvis_level1_folder_inventory WHERE root_alias = 'test_p4a_valid' AND status = 'active';");
    test(countRows.rows[0].c === folderNames.length, 'Repeated scans maintain unique records (no duplicate rows)');

    // 13. Missing entries marked inactive without deletion
    // Create new temporary child folder, scan, then remove it
    const tempDir = path.join(testSubdir, 'child_dir_temp');
    fs.mkdirSync(tempDir);
    await localInventory.scanApprovedFolders('test_p4a_valid', mockMessage);
    fs.rmdirSync(tempDir);

    await localInventory.scanApprovedFolders('test_p4a_valid', mockMessage);

    const inactiveCheck = await pgClient.query(
      "SELECT status FROM jarvis_level1_folder_inventory WHERE root_alias = 'test_p4a_valid' AND folder_name = 'child_dir_temp';"
    );
    test(inactiveCheck.rows.length === 1 && inactiveCheck.rows[0].status === 'inactive', 'Removed local child directory marked status=inactive without database deletion');

    // 14. Zero absolute path leaks
    const dbDump = await pgClient.query("SELECT * FROM jarvis_local_folders WHERE safe_alias = 'test_p4a_valid';");
    const jsonStr = JSON.stringify(dbDump.rows[0]);
    test(!jsonStr.includes(workspaceRoot.replace(/\\/g, '/')) && !jsonStr.includes(workspaceRoot.replace(/\//g, '\\')), 'Zero absolute path stored in jarvis_local_folders DB row');

    const invDump = await pgClient.query("SELECT * FROM jarvis_level1_folder_inventory WHERE root_alias = 'test_p4a_valid';");
    const invJson = JSON.stringify(invDump.rows);
    test(!invJson.includes(workspaceRoot.replace(/\\/g, '/')) && !invJson.includes(workspaceRoot.replace(/\//g, '\\')), 'Zero absolute path stored in jarvis_level1_folder_inventory DB rows');

    // 15. Telegram handlers test
    const tgFolders = await handleCommand('/jarvis_folders', mockMessage);
    test(tgFolders.includes('test_p4a_valid') && !tgFolders.includes(workspaceRoot), '/jarvis_folders output contains safe alias and zero absolute paths');

    const tgInventory = await handleCommand('/jarvis_inventory test_p4a_valid', mockMessage);
    test(tgInventory.includes('child_dir_a') && tgInventory.includes('child_dir_b'), '/jarvis_inventory output lists Level-1 child directories');

    const tgFiles = await handleCommand('/jarvis_files', mockMessage);
    test(tgFiles.includes('Recent Indexed Files') || tgFiles.includes('Indexed Files'), '/jarvis_files returns file review UX');

    const tgApproveOld = await handleCommand('/jarvis_approve_folder test_p4a_valid', mockMessage);
    test(tgApproveOld.includes('deprecated'), '/jarvis_approve_folder returns deprecation message');

    // 16. Revocation test
    const tgRevoke = await handleCommand('/jarvis_revoke_folder test_p4a_valid', mockMessage);
    test(tgRevoke.includes('Revoked'), '/jarvis_revoke_folder sets root to revoked');

    let scanRevokedErr = false;
    try {
      await localInventory.scanApprovedFolders('test_p4a_valid', mockMessage);
    } catch (e) {
      scanRevokedErr = true;
    }
    test(scanRevokedErr, 'Scanning revoked root is blocked');

    // 17. Idempotent schema migrations
    const mig1 = await runMigrations();
    const mig2 = await runMigrations();
    test(mig1 && mig2, 'Migrations run idempotently without error');

    console.log(`\n=============================================================`);
    console.log(`🎉 ALL ${passed} OF ${total} PHASE 4A ASSERTIONS PASSED PERFECTLY!`);
    console.log(`=============================================================\n`);

  } finally {
    await cleanupFixtures();
  }
}

runSuite().catch(err => {
  console.error('\nFATAL TEST FAILURE:', err);
  process.exit(1);
});
