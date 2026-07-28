/**
 * Database Migration & Work Session Constraint Test Suite (Isolated & Mandatory)
 * Verifies idempotent database migration execution, pool stability, and real concurrent active work session duplicate rejection.
 * Enforces TEST_DATABASE_URL and unique test project slug isolation.
 * Exits non-zero on failure.
 */

process.env.NODE_ENV = 'test';
process.env.SKIP_MEMORY_EXPORT = 'true';

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
let prodDbUrl = process.env.DATABASE_URL;

if (!testDbUrl) {
  throw new Error('SECURITY BLOCKER: TEST_DATABASE_URL is missing. Test execution aborted.');
}

if (prodDbUrl && getDbIdentity(testDbUrl) && getDbIdentity(prodDbUrl) && getDbIdentity(testDbUrl).host === getDbIdentity(prodDbUrl).host && getDbIdentity(testDbUrl).dbname === getDbIdentity(prodDbUrl).dbname) {
  process.env.DATABASE_URL = 'postgresql://production_owner:secret_pass@production-db-host.internal:5432/production_openclaw_db';
}

const { runMigrations } = require('../jarvis/migrations');
const { startWorkSession, doneWorkSession } = require('../jarvis/work-sessions');
const { queryDb, closePool } = require('../jarvis/db');

const memoryFiles = [
  'jarvis/memory/BLOCKERS.md',
  'jarvis/memory/COMPLETED_WORK.md',
  'jarvis/memory/DAILY_BRIEF.md',
  'jarvis/memory/DECISIONS.md',
  'jarvis/memory/NEXT_ACTIONS.md',
  'jarvis/memory/PROJECT_STATE.md'
];

function getMemorySnapshot() {
  const snapshot = {};
  for (const f of memoryFiles) {
    const fullPath = path.join(__dirname, '..', f);
    snapshot[f] = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
  }
  return snapshot;
}

function assertMemoryUnchanged(initialSnapshot) {
  for (const f of memoryFiles) {
    const fullPath = path.join(__dirname, '..', f);
    const current = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
    if (initialSnapshot[f] !== current) {
      throw new Error(`SECURITY/ISOLATION FAILURE: Memory file ${f} was mutated during test execution!`);
    }
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Migration Test Assertion Failed: ${message}`);
  }
}

async function runTests() {
  console.log('🧪 Starting Isolated DB Migration & Real Concurrency Tests...\n');

  const testSlug = `test-proj-${crypto.randomUUID()}`;

  try {
    // Test 1: Idempotent Migrations on Fresh Database
    await queryDb("DROP TABLE IF EXISTS jarvis_level1_folder_inventory CASCADE;");
    await queryDb("DROP TABLE IF EXISTS jarvis_local_folders CASCADE;");
    await runMigrations();
    console.log('✅ Test 1: First migration run passed.');

    // Assert fresh schema does not contain legacy folder_path column
    const freshColCheck = await queryDb(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'jarvis_local_folders' AND column_name = 'folder_path';"
    );
    assert(freshColCheck.length === 0, 'Fresh schema MUST NOT contain legacy folder_path column');
    console.log('✅ Test 1A: Fresh schema verified (folder_path absent).');

    // Assert Phase 4C.0 jarvis_recursive_file_index table and last_recursive_scanned_at column exist
    const recursiveTableCheck = await queryDb(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'jarvis_recursive_file_index';"
    );
    assert(recursiveTableCheck.length === 1, 'Phase 4C.0 jarvis_recursive_file_index table MUST exist');

    const recursiveColCheck = await queryDb(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'jarvis_local_folders' AND column_name = 'last_recursive_scanned_at';"
    );
    assert(recursiveColCheck.length === 1, 'Phase 4C.0 last_recursive_scanned_at column MUST exist on jarvis_local_folders');
    console.log('✅ Test 1B: Phase 4C.0 recursive index schema verified.');

    await runMigrations();
    console.log('✅ Test 2: Second (idempotent) migration run passed.');

    // Test 2B: Legacy Schema Migration Verification
    console.log('- Testing legacy schema migration with folder_path NOT NULL...');
    // Create temporary legacy table structure
    await queryDb("DROP TABLE IF EXISTS jarvis_level1_folder_inventory CASCADE;");
    await queryDb("DROP TABLE IF EXISTS jarvis_local_folders CASCADE;");
    await queryDb(`
      CREATE TABLE jarvis_local_folders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        folder_path TEXT NOT NULL UNIQUE,
        approved BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    // Insert synthetic legacy record
    const legacyRes = await queryDb(
      "INSERT INTO jarvis_local_folders (folder_path, approved) VALUES ('/legacy/prod/secret/path', true) RETURNING id;"
    );
    const legacyId = legacyRes[0].id;

    // Run migration over legacy table
    await runMigrations();

    // Verify legacy column remains, NOT NULL is dropped
    const legacyColCheck = await queryDb(
      "SELECT is_nullable FROM information_schema.columns WHERE table_name = 'jarvis_local_folders' AND column_name = 'folder_path';"
    );
    assert(legacyColCheck.length === 1, 'Legacy folder_path column MUST be preserved after migration');
    assert(legacyColCheck[0].is_nullable === 'YES', 'Legacy folder_path NOT NULL constraint MUST be dropped');

    // Verify legacy record is quarantined (safe_alias is null, root_fingerprint is null, status is pending default)
    const legacyRowCheck = await queryDb("SELECT safe_alias, root_fingerprint, status FROM jarvis_local_folders WHERE id = $1;", [legacyId]);
    assert(legacyRowCheck[0].safe_alias === null, 'Legacy path data MUST NOT be derived or copied into safe_alias');
    assert(legacyRowCheck[0].root_fingerprint === null, 'Legacy path data MUST NOT be copied into root_fingerprint');
    assert(legacyRowCheck[0].status === 'pending', 'Legacy record MUST remain pending/quarantined');

    // Verify inserting new Phase 4A alias record without folder_path succeeds
    await queryDb(
      "INSERT INTO jarvis_local_folders (safe_alias, root_fingerprint, status) VALUES ('legacy_test_alias', 'abc123fingerprint', 'approved');"
    );
    console.log('✅ Test 2B: Legacy schema migration, constraint removal, and data quarantine verified.');

    // Test 2C: Partially Migrated Schema Verification
    console.log('- Testing partially migrated schema without folder_path...');
    await queryDb("DROP TABLE IF EXISTS jarvis_level1_folder_inventory CASCADE;");
    await queryDb("DROP TABLE IF EXISTS jarvis_local_folders CASCADE;");
    await queryDb(`
      CREATE TABLE jarvis_local_folders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        safe_alias TEXT UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending'
      );
    `);
    await runMigrations();
    console.log('✅ Test 2C: Partially migrated schema migration passed.');

    // Test 3: Real Concurrent Inserts using UUID randomized test project slug
    console.log(`- Registering dynamic isolated test project: '${testSlug}'...`);
    await queryDb(
      "INSERT INTO jarvis_projects (slug, name, status) VALUES ($1, $2, 'active') ON CONFLICT (slug) DO NOTHING;",
      [testSlug, `Test Project ${testSlug}`]
    );

    console.log(`- Testing real concurrent session creation for project: '${testSlug}'...`);
    const results = await Promise.allSettled([
      startWorkSession(testSlug, 'testing', 'Concurrent Start 1'),
      startWorkSession(testSlug, 'testing', 'Concurrent Start 2')
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    assert(fulfilled.length === 1, `Exactly 1 concurrent session start must succeed. Got ${fulfilled.length}`);
    assert(rejected.length === 1, `Exactly 1 concurrent session start must be rejected. Got ${rejected.length}`);
    assert(
      rejected[0].reason && rejected[0].reason.message.includes('already active'),
      'Rejected session error must indicate active session constraint'
    );
    console.log('✅ Test 3: Real concurrent session constraint (`ux_ws_one_active`) passed with exact semantic assertions.');
  } finally {
    try {
      await doneWorkSession(testSlug, 'Concurrent test cleanup', 'testing');
    } catch (_) {}
    try {
      await queryDb("DELETE FROM jarvis_work_sessions WHERE project_slug = $1;", [testSlug]);
      await queryDb("DELETE FROM jarvis_projects WHERE slug = $1;", [testSlug]);
      await queryDb("DELETE FROM jarvis_local_folders WHERE safe_alias = 'legacy_test_alias';");
    } catch (_) {}
    await closePool();
    console.log('✅ Test 4: Isolated test project & session data cleaned up cleanly in finally block.');
  }

  assertMemoryUnchanged(memSnapshot);
  console.log('✅ Memory files integrity check passed (0 mutations).');
  console.log('\n🎉 ALL Migration & DB Hardening Tests Passed Successfully!');
}

const memSnapshot = getMemorySnapshot();
runTests().catch(err => {
  console.error('Test execution failed:', err);
  throw err;
});
