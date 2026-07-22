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

function normalizePgUrl(urlStr) {
  if (!urlStr) return '';
  try {
    const u = new URL(urlStr);
    return `${u.protocol}//${u.username}:${u.password}@${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch (e) {
    return urlStr.trim();
  }
}

const testDbUrl = process.env.TEST_DATABASE_URL;
const prodDbUrl = process.env.DATABASE_URL;

if (!testDbUrl) {
  throw new Error('SECURITY BLOCKER: TEST_DATABASE_URL is missing. Test execution aborted.');
}
if (prodDbUrl && normalizePgUrl(testDbUrl) === normalizePgUrl(prodDbUrl)) {
  throw new Error('SECURITY BLOCKER: TEST_DATABASE_URL matches DATABASE_URL. Execution aborted to protect production database.');
}

process.env.DATABASE_URL = testDbUrl;

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

  // Test 1: Idempotent Migrations
  try {
    await runMigrations();
    console.log('✅ Test 1: First migration run passed.');
    await runMigrations();
    console.log('✅ Test 2: Second (idempotent) migration run passed.');
  } catch (err) {
    console.error('❌ Migration execution failed:', err.message);
    process.exit(1);
  }

  // Test 3: Real Concurrent Inserts using UUID randomized test project slug
  const testSlug = `test-proj-${crypto.randomUUID()}`;
  console.log(`- Registering dynamic isolated test project: '${testSlug}'...`);

  try {
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
  } catch (err) {
    console.error('❌ Concurrency test failed:', err.message);
    process.exit(1);
  } finally {
    try {
      await doneWorkSession(testSlug, 'Concurrent test cleanup', 'testing');
    } catch (_) {}
    await queryDb("DELETE FROM jarvis_work_sessions WHERE project_slug = $1;", [testSlug]);
    await queryDb("DELETE FROM jarvis_projects WHERE slug = $1;", [testSlug]);
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
  process.exit(1);
});
