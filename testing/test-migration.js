/**
 * Database Migration & Work Session Constraint Test Suite (Isolated & Mandatory)
 * Verifies idempotent database migration execution, pool stability, and real concurrent active work session duplicate rejection.
 * Enforces TEST_DATABASE_URL and unique test project slug isolation.
 * Exits non-zero on failure.
 */

require('dotenv').config();

const { runMigrations } = require('../jarvis/migrations');
const { startWorkSession, doneWorkSession } = require('../jarvis/work-sessions');
const { queryDb, closePool } = require('../jarvis/db');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ Assertion failed: ${message}`);
    process.exit(1);
  }
}

async function runTests() {
  console.log('🧪 Starting Isolated DB Migration & Real Concurrency Tests...\n');

  const testDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!testDbUrl) {
    console.error('❌ SECURITY BLOCKER: TEST_DATABASE_URL (or DATABASE_URL) is missing. Mandatory DB tests cannot run. Release blocked.');
    process.exit(1);
  }

  // Set DATABASE_URL to test DB for connection pool
  process.env.DATABASE_URL = testDbUrl;

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

  // Test 3: Real Concurrent Inserts using unique test project slug
  const testSlug = `test-proj-${Date.now()}`;
  console.log(`- Registering dynamic isolated test project: '${testSlug}'...`);

  try {
    await queryDb(
      "INSERT INTO jarvis_projects (slug, name, status) VALUES ($1, $2, 'active') ON CONFLICT (slug) DO NOTHING;",
      [testSlug, `Test Project ${Date.now()}`]
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
    console.log('✅ Test 3: Real concurrent session constraint (`ux_ws_one_active`) passed.');

    // Clean up test sessions & test project
    await doneWorkSession(testSlug, 'Concurrent test cleanup', 'testing');
    await queryDb("DELETE FROM jarvis_work_sessions WHERE project_slug = $1;", [testSlug]);
    await queryDb("DELETE FROM jarvis_projects WHERE slug = $1;", [testSlug]);
    console.log('✅ Test 4: Isolated test project & session data cleaned up cleanly.');
  } catch (err) {
    console.error('❌ Concurrency test failed:', err.message);
    process.exit(1);
  } finally {
    await closePool();
  }

  console.log('\n🎉 ALL Migration & DB Hardening Tests Passed Successfully!');
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
