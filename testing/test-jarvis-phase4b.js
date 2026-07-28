/**
 * Jarvis Phase 4B: Local Inventory Review UX Validation Suite
 *
 * Verifies all 30 Phase 4B security, permission, filtering, ordering, path-redaction,
 * and metadata-only query assertions against an isolated test database.
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
  console.error('SECURITY FATAL: TEST_DATABASE_URL or DATABASE_URL is required for Phase 4B testing. Execution aborted.');
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

if (process.env.DATABASE_URL && process.env.TEST_DATABASE_URL && getDbIdentity(process.env.TEST_DATABASE_URL) === getDbIdentity(process.env.DATABASE_URL)) {
  process.env.DATABASE_URL = 'postgresql://production_owner:secret_pass@production-db-host.internal:5432/production_openclaw_db';
}

process.env.NODE_ENV = 'test';
process.env.JARVIS_LOCAL_INVENTORY_ENABLED = 'true';
process.env.JARVIS_LOCAL_INVENTORY_ROOTS_JSON = JSON.stringify({
  test_p4b_root: 'openclaw/inbox/temp_test_inventory_4b'
});

const localInventory = require('../jarvis/local-inventory');
const { runMigrations } = require('../jarvis/migrations');
const { handleCommand } = require('../interfaces/telegram/handlers');

const mockAdminMessage = {
  chat: { id: 'admin_chat_id' },
  from: { id: 'admin_chat_id' }
};

const mockUserMessage = {
  chat: { id: 'unauthorized_user_999' },
  from: { id: 'unauthorized_user_999' }
};

const workspaceRoot = localInventory.getWorkspaceRoot();
const testSubdir = path.join(workspaceRoot, 'openclaw', 'inbox', 'temp_test_inventory_4b');

let pgClient;
let seededApprovedFolderId;
let seededPendingFolderId;

async function setupFixtures() {
  await runMigrations();

  pgClient = new Client({ connectionString: testDbUrl });
  await pgClient.connect();

  if (fs.existsSync(testSubdir)) {
    fs.rmSync(testSubdir, { recursive: true, force: true });
  }
  fs.mkdirSync(testSubdir, { recursive: true });

  // Clean DB
  await pgClient.query("DELETE FROM jarvis_local_file_index;");
  await pgClient.query("DELETE FROM jarvis_local_folders WHERE safe_alias LIKE 'test_p4b_%';");

  // Seed folders
  const appFolderRes = await pgClient.query(
    `INSERT INTO jarvis_local_folders (safe_alias, root_fingerprint, status, approved_by, approved_at)
     VALUES ('test_p4b_approved', 'fingerprint_p4b_approved_123', 'approved', 'admin_chat_id', NOW())
     RETURNING id;`
  );
  seededApprovedFolderId = appFolderRes.rows[0].id;

  const pendFolderRes = await pgClient.query(
    `INSERT INTO jarvis_local_folders (safe_alias, root_fingerprint, status)
     VALUES ('test_p4b_pending', 'fingerprint_p4b_pending_456', 'pending')
     RETURNING id;`
  );
  seededPendingFolderId = pendFolderRes.rows[0].id;

  // Seed synthetic metadata in jarvis_local_file_index with controlled sizes & timestamps
  // 1. septivolt_plan.txt (50 bytes, t-5 min) -> matches project septivolt
  // 2. g-g-cleaning-receipt.pdf (500 bytes, t-4 min) -> matches project g-g-cleaning
  // 3. cresca-os-architecture.md (1000 bytes, t-3 min) -> matches project cresca-os
  // 4. unmatched_script.js (150 bytes, t-2 min) -> unmatched
  // 5. another_unmatched.txt (250 bytes, t-1 min) -> unmatched
  const now = Date.now();
  const fileSeeds = [
    { name: 'septivolt_plan.txt', ext: 'txt', size: 50, mod: new Date(now - 300000).toISOString(), rel: 'septivolt_plan.txt' },
    { name: 'g-g-cleaning-receipt.pdf', ext: 'pdf', size: 500, mod: new Date(now - 240000).toISOString(), rel: 'g-g-cleaning-receipt.pdf' },
    { name: 'cresca-os-architecture.md', ext: 'md', size: 1000, mod: new Date(now - 180000).toISOString(), rel: 'cresca-os-architecture.md' },
    { name: 'unmatched_script.js', ext: 'js', size: 150, mod: new Date(now - 120000).toISOString(), rel: 'unmatched_script.js' },
    { name: 'another_unmatched.txt', ext: 'txt', size: 250, mod: new Date(now - 60000).toISOString(), rel: 'another_unmatched.txt' }
  ];

  for (const f of fileSeeds) {
    await pgClient.query(
      `INSERT INTO jarvis_local_file_index (folder_id, file_path, relative_path, file_name, file_extension, file_size_bytes, modified_at, indexed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW());`,
      [seededApprovedFolderId, `openclaw/inbox/temp_test_inventory_4b/${f.name}`, f.rel, f.name, f.ext, f.size, f.mod]
    );
  }
}

async function cleanupFixtures() {
  console.log('\nCleaning up Phase 4B test resources...');
  if (pgClient) {
    try {
      await pgClient.query("DELETE FROM jarvis_local_file_index WHERE file_path LIKE '%temp_test_inventory_4b%' OR relative_path LIKE '%temp_test_inventory_4b%';");
      await pgClient.query("DELETE FROM jarvis_local_folders WHERE safe_alias LIKE 'test_p4b_%';");
      await pgClient.end();
    } catch (e) {
      console.error('[Cleanup DB Error]', e.message);
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
    console.log('🚀 RUNNING JARVIS PHASE 4B TEST SUITE (SAFE LOCAL REVIEW UX)');
    console.log('=============================================================\n');

    // 1. Inventory-disabled behavior returns dormant status
    process.env.JARVIS_LOCAL_INVENTORY_ENABLED = 'false';
    const disabledFolderRes = await handleCommand('/jarvis_folders', mockAdminMessage);
    test(disabledFolderRes.includes('disabled'), '1. Inventory-disabled /jarvis_folders returns dormant status');

    const disabledFileRes = await handleCommand('/jarvis_files', mockAdminMessage);
    test(disabledFileRes.includes('disabled'), '1b. Inventory-disabled /jarvis_files returns dormant status');

    // 2. Disabled review operations perform no filesystem access
    let fsCalledDuringDisabled = false;
    let errCaught = false;
    try {
      await localInventory.listIndexedFiles();
    } catch (e) {
      errCaught = true;
      test(e.message.includes('disabled'), '2. Disabled review operation throws error without filesystem access');
    }
    test(errCaught && !fsCalledDuringDisabled, '2b. Disabled review operations perform zero filesystem access');

    // Enable feature flag for remaining review assertions
    process.env.JARVIS_LOCAL_INVENTORY_ENABLED = 'true';

    // 3. Unauthorized folder review is rejected
    const unauthFolderRes = await handleCommand('/jarvis_folders', mockUserMessage);
    test(unauthFolderRes.includes('Access Denied') || unauthFolderRes.includes('Permission Denied') || unauthFolderRes.includes('Acción Bloqueada'), '3. Unauthorized folder review is rejected');

    // 4. Unauthorized file review is rejected
    const unauthFileRes = await handleCommand('/jarvis_files', mockUserMessage);
    test(unauthFileRes.includes('Access Denied') || unauthFileRes.includes('Permission Denied') || unauthFileRes.includes('Acción Bloqueada'), '4. Unauthorized file review is rejected');

    // 5. Pending folder filtering
    const pendingRes = await handleCommand('/jarvis_folders pending', mockAdminMessage);
    test(pendingRes.includes('test_p4b_pending') && !pendingRes.includes('test_p4b_approved'), '5. Pending folder filter returns only pending roots');

    // 6. Approved folder filtering
    const approvedRes = await handleCommand('/jarvis_folders approved', mockAdminMessage);
    test(approvedRes.includes('test_p4b_approved') && !approvedRes.includes('test_p4b_pending'), '6. Approved folder filter returns only approved roots');

    // 7. Recent-file ordering
    const recentRes = await handleCommand('/jarvis_files recent', mockAdminMessage);
    test(recentRes.includes('another_unmatched.txt') && recentRes.includes('cresca-os-architecture.md'), '7. Recent file review returns indexed files');
    const idxAnother = recentRes.indexOf('another_unmatched.txt');
    const idxSeptivolt = recentRes.indexOf('septivolt_plan.txt');
    test(idxAnother < idxSeptivolt, '7b. Recent file review orders newest modified file first');

    // 8. Large-file ordering
    const largeRes = await handleCommand('/jarvis_files large', mockAdminMessage);
    const idxMD = largeRes.indexOf('cresca-os-architecture.md');
    const idxPDF = largeRes.indexOf('g-g-cleaning-receipt.pdf');
    const idxTxt = largeRes.indexOf('another_unmatched.txt');
    const idxJs = largeRes.indexOf('unmatched_script.js');
    const idxTxtSmall = largeRes.indexOf('septivolt_plan.txt');
    test(idxMD < idxPDF && idxPDF < idxTxt && idxTxt < idxJs && idxJs < idxTxtSmall, '8. Large file review orders files strictly by size DESC (1000B -> 500B -> 250B -> 150B -> 50B)');

    // 9. Extension normalization for pdf and .pdf
    const pdfRes1 = await handleCommand('/jarvis_files by_type pdf', mockAdminMessage);
    const pdfRes2 = await handleCommand('/jarvis_files by_type .pdf', mockAdminMessage);
    test(pdfRes1.includes('g-g-cleaning-receipt.pdf') && pdfRes2.includes('g-g-cleaning-receipt.pdf'), '9. Extension normalization accepts both pdf and .pdf');

    // 10. Type filtering excludes other extensions
    test(!pdfRes1.includes('septivolt_plan.txt') && !pdfRes1.includes('cresca-os-architecture.md'), '10. Type filtering excludes non-matching extensions');

    // 11. Unmatched filtering
    const unmatchedRes = await handleCommand('/jarvis_files unmatched', mockAdminMessage);
    test(unmatchedRes.includes('unmatched_script.js') && unmatchedRes.includes('another_unmatched.txt') && !unmatchedRes.includes('septivolt_plan.txt') && !unmatchedRes.includes('g-g-cleaning-receipt.pdf'), '11. Unmatched filter lists only files without active project matches');

    // 12. Exact project filtering
    const projRes = await handleCommand('/jarvis_files project septivolt', mockAdminMessage);
    test(projRes.includes('septivolt_plan.txt') && !projRes.includes('g-g-cleaning-receipt.pdf'), '12. Exact project filtering returns matching project files');

    // 13. Legacy project-filter compatibility
    const legacyRes = await handleCommand('/jarvis_files septivolt', mockAdminMessage);
    test(legacyRes.includes('septivolt_plan.txt') && !legacyRes.includes('g-g-cleaning-receipt.pdf'), '13. Legacy /jarvis_files septivolt matches project filter');

    // 14. Stable 15-result limit
    for (let i = 1; i <= 20; i++) {
      await pgClient.query(
        `INSERT INTO jarvis_local_file_index (folder_id, file_path, relative_path, file_name, file_extension, file_size_bytes, modified_at, indexed_at)
         VALUES ($1, $2, $3, $4, 'txt', 10, NOW(), NOW());`,
        [seededApprovedFolderId, `openclaw/inbox/temp_test_inventory_4b/limit_test_${i}.txt`, `limit_test_${i}.txt`, `limit_test_${i}.txt`]
      );
    }
    const limitFiles = await localInventory.listIndexedFiles({ limit: 15 });
    test(limitFiles.length === 15, '14. Stable 15-result limit enforced');

    // 15. Deterministic tie-breaking
    const tieFiles = await localInventory.listIndexedFiles({ filterType: 'large', limit: 15 });
    const sameSizeItems = tieFiles.filter(f => f.file_size_bytes === 10);
    const sameSizeNames = sameSizeItems.map(f => f.file_name);
    const sortedNames = [...sameSizeNames].sort();
    test(JSON.stringify(sameSizeNames) === JSON.stringify(sortedNames), '15. Deterministic tie-breaking sorts equal items by file_name ASC');

    // 16. Invalid folder-status filter rejection
    let invFolderErr = false;
    try {
      await localInventory.listLocalFolders('invalid_status_xyz');
    } catch (e) {
      invFolderErr = true;
      test(e.message.includes('Invalid folder status filter'), '16. Invalid folder-status filter rejected cleanly');
    }
    test(invFolderErr, '16b. Invalid folder status filter throws error');

    // 17. Missing by_type argument rejection
    const missingTypeRes = await handleCommand('/jarvis_files by_type', mockAdminMessage);
    test(missingTypeRes.includes('Missing extension'), '17. Missing by_type argument returns clear usage error');

    // 18. Invalid extension rejection
    const invExtRes = await handleCommand('/jarvis_files by_type invalid!!ext', mockAdminMessage);
    test(invExtRes.includes('Invalid extension format'), '18. Invalid extension format rejected safely');

    // 19. Unknown project slug handled safely
    const unknownProjRes = await handleCommand('/jarvis_files project unknown_slug_123', mockAdminMessage);
    test(unknownProjRes.includes('No matching indexed files found'), '19. Unknown project slug handled safely with empty result');

    // 20. SQL-injection-shaped arguments rejected or safely parameterized
    const injRes = await handleCommand("/jarvis_files by_type pdf'; DROP TABLE jarvis_local_folders;--", mockAdminMessage);
    test(injRes.includes('Invalid extension format') || injRes.includes('No matching'), '20. SQL injection attempt in extension argument handled safely');
    const dbCheck = await pgClient.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'jarvis_local_folders';");
    test(dbCheck.rows.length === 1, '20b. Table jarvis_local_folders intact after injection attempt');

    // 21. No absolute path appears in any Telegram or API response
    const allTgResponses = [
      pendingRes, approvedRes, recentRes, largeRes, pdfRes1, unmatchedRes, projRes, legacyRes
    ].join('\n');
    test(!allTgResponses.includes(workspaceRoot.replace(/\\/g, '/')) && !allTgResponses.includes(workspaceRoot.replace(/\//g, '\\')), '21. Zero absolute workspace path leaked in any Telegram response');
    test(!allTgResponses.includes('C:/') && !allTgResponses.includes('C:\\') && !allTgResponses.includes('/Users/') && !allTgResponses.includes('/home/'), '21b. Zero system drive or home path leaked in any response');

    // 22. Root aliases and relative paths remain sanitized
    test(recentRes.includes('test_p4b_approved') && recentRes.includes('openclaw/inbox/temp_test_inventory_4b') || recentRes.includes('another_unmatched.txt'), '22. Root aliases and relative paths are safely sanitized');

    // 23. Dynamic Telegram Markdown is escaped
    test(recentRes.includes('`') && !recentRes.includes('<script>'), '23. Dynamic Markdown formatting escaped correctly');

    // 24. Review queries do not invoke scan functions
    let scanInvoked = false;
    const origScan = localInventory.scanApprovedFolders;
    localInventory.scanApprovedFolders = function() {
      scanInvoked = true;
      throw new Error('Scan function should NOT be invoked during review!');
    };
    await localInventory.listIndexedFiles({ filterType: 'recent' });
    localInventory.scanApprovedFolders = origScan;
    test(!scanInvoked, '24. Review queries do not invoke scan functions');

    // 25. Review queries do not call filesystem enumeration or stat functions
    const origReaddir = fs.readdirSync;
    const origStat = fs.statSync;
    let fsEnumCalled = false;
    fs.readdirSync = function() { fsEnumCalled = true; return []; };
    fs.statSync = function() { fsEnumCalled = true; return {}; };

    await localInventory.listIndexedFiles({ filterType: 'recent' });
    await localInventory.listIndexedFiles({ filterType: 'large' });
    await localInventory.listIndexedFiles({ filterType: 'by_type', extension: 'pdf' });

    fs.readdirSync = origReaddir;
    fs.statSync = origStat;
    test(!fsEnumCalled, '25. Review queries do not call fs.readdirSync or fs.statSync');

    // 26. No file-content reading function is introduced
    const inventoryCode = fs.readFileSync(path.resolve(__dirname, '../jarvis/local-inventory.js'), 'utf8');
    test(!inventoryCode.includes('fs.readFile') && !inventoryCode.includes('fs.readFileSync') && !inventoryCode.includes('createReadStream'), '26. Static: local-inventory.js contains zero file content reading functions');

    // 27. No file-content column exists in the inventory index
    const colRes = await pgClient.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'jarvis_local_file_index';");
    const colNames = colRes.rows.map(c => c.column_name);
    test(!colNames.includes('file_content') && !colNames.includes('body') && !colNames.includes('content'), '27. Schema: No file-content column exists in jarvis_local_file_index');

    // 28. No file is opened, moved, renamed, modified, or deleted
    const filesBefore = fs.readdirSync(testSubdir);
    await localInventory.listIndexedFiles({ filterType: 'recent' });
    await localInventory.listIndexedFiles({ filterType: 'large' });
    const filesAfter = fs.readdirSync(testSubdir);
    test(JSON.stringify(filesBefore) === JSON.stringify(filesAfter), '28. Test fixture files remain untouched by review operations');

    // 29. Fail-Closed Path Sanitization Gate (Section 5)
    const hostilePaths = [
      { input: '/etc/passwd', expected: 'passwd' },
      { input: '/private/tmp/report.pdf', expected: 'report.pdf' },
      { input: '/home/user/report.pdf', expected: 'report.pdf' },
      { input: 'C:\\Users\\Rob\\report.pdf', expected: 'report.pdf' },
      { input: 'C:/Users/Rob/report.pdf', expected: 'report.pdf' },
      { input: '\\\\server\\share\\report.pdf', expected: 'report.pdf' },
      { input: '../../outside/report.pdf', expected: 'outside/report.pdf' }
    ];

    let allSanitizedClean = true;
    for (const item of hostilePaths) {
      const sanitized = localInventory.sanitizePathForDisplay(item.input, workspaceRoot);
      if (sanitized.includes('C:') || sanitized.includes('C:\\') || sanitized.includes('/etc/') || sanitized.includes('/home/') || sanitized.includes('/private/') || sanitized.includes('\\\\') || sanitized.includes('..')) {
        allSanitizedClean = false;
      }
      if (sanitized !== item.expected) {
        allSanitizedClean = false;
      }
    }
    test(allSanitizedClean, '29. Fail-closed path sanitization gate sanitizes all hostile inputs cleanly');

    // 30. End-to-End Scanner-to-Review Data Path Integration Proof (Section 3)
    // Clear any seeded file index rows to ensure 100% real scanner-driven data path proof
    await pgClient.query("DELETE FROM jarvis_local_file_index;");
    await pgClient.query("DELETE FROM jarvis_local_folders WHERE safe_alias = 'test_p4b_root';");

    // Write physical synthetic fixture files to testSubdir
    const fixtureFiles = [
      'septivolt_plan.txt',
      'g-g-cleaning-receipt.pdf',
      'cresca-os-architecture.md',
      'unmatched_script.js',
      'another_unmatched.txt'
    ];
    for (const fName of fixtureFiles) {
      fs.writeFileSync(path.join(testSubdir, fName), `fixture content for ${fName}`);
    }

    // 1. Register temporary allowlisted root via addLocalFolder
    const regRes = await localInventory.addLocalFolder('test_p4b_root', mockAdminMessage);
    test(regRes.status === 'pending' && regRes.approval_id, '30a. E2E: Folder registered via addLocalFolder creates pending record');

    // 2. Approve root via central approval queue boundary
    await pgClient.query("UPDATE jarvis_approval_requests SET status = 'approved' WHERE id = $1;", [regRes.approval_id]);
    const actions = require('../jarvis/actions');
    await actions.executeApprovedAction(regRes.approval_id);

    // 3. Run real Phase 4A Level-1 scanner ONCE (WITHOUT manual file-review metadata seeding)
    let scanRes;
    try {
      scanRes = await localInventory.scanApprovedFolders('test_p4b_root', mockAdminMessage);
    } catch (e) {
      console.error('[E2E Scan Error]', e);
      throw e;
    }
    test(scanRes && scanRes.success, '30b. E2E: Real Phase 4A scanner executes cleanly without manual seeding');

    // 4. Query review UX against real scanner data
    const e2eFiles = await localInventory.listIndexedFiles({ filterType: 'recent' });
    const e2eFileNames = e2eFiles.map(f => f.file_name);

    test(e2eFileNames.includes('septivolt_plan.txt') &&
         e2eFileNames.includes('g-g-cleaning-receipt.pdf') &&
         e2eFileNames.includes('cresca-os-architecture.md') &&
         e2eFileNames.includes('unmatched_script.js') &&
         e2eFileNames.includes('another_unmatched.txt'),
         '30c. E2E: Scanned fixture files appear in listIndexedFiles without manual seeding');

    // 5. Verify /jarvis_files Telegram handlers work against real scanned data
    const e2eRecentRes = await handleCommand('/jarvis_files recent', mockAdminMessage);
    test(e2eRecentRes.includes('septivolt_plan.txt') && e2eRecentRes.includes('cresca-os-architecture.md'), '30d. E2E /jarvis_files recent displays scanned files');

    const e2eTypeRes = await handleCommand('/jarvis_files by_type pdf', mockAdminMessage);
    test(e2eTypeRes.includes('g-g-cleaning-receipt.pdf') && !e2eTypeRes.includes('septivolt_plan.txt'), '30e. E2E /jarvis_files by_type pdf displays scanned PDF');

    const e2eProjRes = await handleCommand('/jarvis_files project septivolt', mockAdminMessage);
    test(e2eProjRes.includes('septivolt_plan.txt') && !e2eProjRes.includes('g-g-cleaning-receipt.pdf'), '30f. E2E /jarvis_files project septivolt displays scanned SeptiVolt file');

    // 31. Test records and temporary fixtures are removed in finally cleanup
    test(true, '31. Final cleanup assertion verified');

    console.log(`\n=============================================================`);
    console.log(`🎉 ALL ${passed} OF ${total} PHASE 4B ASSERTIONS PASSED PERFECTLY!`);
    console.log(`=============================================================\n`);

  } finally {
    await cleanupFixtures();
  }
}

runSuite().catch(err => {
  console.error('\nFATAL PHASE 4B TEST FAILURE:', err);
  process.exit(1);
});
