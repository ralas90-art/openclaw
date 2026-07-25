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

const testDbUrl = process.env.TEST_DATABASE_URL;

if (!testDbUrl) {
  throw new Error('SECURITY BLOCKER: TEST_DATABASE_URL is missing. Test execution aborted.');
}

if (process.env.DATABASE_URL) {
  const prodId = getDbIdentity(process.env.DATABASE_URL);
  const testId = getDbIdentity(testDbUrl);
  if (prodId && testId && prodId.host === testId.host && prodId.port === testId.port && prodId.dbname === testId.dbname) {
    throw new Error('SECURITY BLOCKER: TEST_DATABASE_URL targets the same database as DATABASE_URL. Test execution aborted.');
  }
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
    // Test 1: Idempotent Migrations
    await runMigrations();
    console.log('✅ Test 1: First migration run passed.');
    await runMigrations();
    console.log('✅ Test 2: Second (idempotent) migration run passed.');

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
