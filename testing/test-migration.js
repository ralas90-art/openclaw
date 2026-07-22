/**
 * Database Migration & Work Session Constraint Test Suite
 * Verifies idempotent database migration execution, pool stability, and real concurrent active work session duplicate rejection.
 * Exits non-zero on failure.
 */

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
  console.log('🧪 Starting Migration & Real Concurrency DB Hardening Tests...\n');

  if (!process.env.DATABASE_URL) {
    console.log('⚠️ SKIPPED: DATABASE_URL not configured. Skipping live DB migration tests.');
    process.exit(0);
  }

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

  // Test 3: Real Concurrent Inserts using Promise.allSettled with valid project slug
  const testSlug = 'cresca-os';

  try {
    // Clean up any active session for test project first
    await queryDb("UPDATE jarvis_work_sessions SET status = 'completed' WHERE project_slug = $1 AND status IN ('active', 'updated');", [testSlug]);

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

    // Clean up test session
    await doneWorkSession(testSlug, 'Concurrent test cleanup', 'testing');
    console.log('✅ Test 4: Session cleanup completed.');
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
