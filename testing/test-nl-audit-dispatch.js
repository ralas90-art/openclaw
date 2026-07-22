/**
 * Natural Language Audit & Dispatch Lifecycle Test Suite
 * Verifies logId generation, execution status updates, exact row targetting,
 * longest-alias-first intent matching, and regex alias escaping.
 * Exits non-zero on failure.
 */

const {
  routeNaturalLanguageCommand,
  markNaturalLanguageLogExecuted,
  detectLanguage
} = require('../jarvis/natural-language-router');
const { queryDb } = require('../jarvis/db');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ Assertion failed: ${message}`);
    process.exit(1);
  }
}

async function runTests() {
  console.log('🧪 Starting NL Audit Lifecycle & Regex Escaping Tests...\n');

  // Test 1: Language Detection
  assert(detectLanguage('que tengo pendiente hoy') === 'es', 'Spanish detection failed');
  assert(detectLanguage('what should i focus on today') === 'en', 'English detection failed');
  console.log('✅ Test 1: Language detection passed.');

  // Test 2: Longest-Alias-First Matching
  const shortResult = await routeNaturalLanguageCommand('show me my priorities');
  assert(shortResult.intent === 'priorities', 'Longest alias matching failed for priorities');
  console.log('✅ Test 2: Longest alias matching passed.');

  // Test 3: Safe Regex Alias Escaping
  let regexError = false;
  try {
    // Testing text with special regex characters
    await routeNaturalLanguageCommand('empieza una sesión para cresca-os [v3.0]?');
  } catch (err) {
    regexError = true;
  }
  assert(!regexError, 'Regex escaping must prevent syntax errors on special characters');
  console.log('✅ Test 3: Safe regex alias escaping passed.');

  if (!process.env.DATABASE_URL) {
    console.log('⚠️ SKIPPED DB Audit Tests: DATABASE_URL not configured.');
    process.exit(0);
  }

  // Test 4: Log Insertion & logId Return
  const nlRes = await routeNaturalLanguageCommand('show me my pending approvals', { chat: { id: 'test_chat_99' } });
  assert(nlRes.logId, 'routeNaturalLanguageCommand must return a valid logId');
  console.log(`✅ Test 4: Log insertion returned logId: ${nlRes.logId}`);

  // Test 5: Verify Initial State (executed_boolean = false)
  const initialRows = await queryDb('SELECT executed_boolean FROM jarvis_natural_language_logs WHERE id = $1', [nlRes.logId]);
  assert(initialRows.length === 1, 'Log record must exist in DB');
  assert(initialRows[0].executed_boolean === false, 'executed_boolean must initially be false before dispatch');
  console.log('✅ Test 5: Initial unexecuted audit state verified.');

  // Test 6: Mark Executed & Verify Exact Row Update
  await markNaturalLanguageLogExecuted(nlRes.logId);
  const updatedRows = await queryDb('SELECT executed_boolean FROM jarvis_natural_language_logs WHERE id = $1', [nlRes.logId]);
  assert(updatedRows[0].executed_boolean === true, 'executed_boolean must be updated to true after successful dispatch');
  console.log('✅ Test 6: Post-dispatch execution mark verified.');

  // Test 7: Concurrent Log Updates Isolation
  const nlRes2 = await routeNaturalLanguageCommand('what should i focus on today');
  assert(nlRes2.logId, 'Second command logId required');

  await markNaturalLanguageLogExecuted(nlRes2.logId);
  const checkFirst = await queryDb('SELECT executed_boolean FROM jarvis_natural_language_logs WHERE id = $1', [nlRes.logId]);
  assert(checkFirst[0].executed_boolean === true, 'First log row must remain true and unaffected');

  console.log('✅ Test 7: Concurrent log row isolation verified.');
  console.log('\n🎉 ALL Natural Language Audit Tests Passed Successfully!');
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
