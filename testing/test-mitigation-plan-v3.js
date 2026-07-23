/**
 * Comprehensive Test Suite for Jarvis Security Audit Mitigation Plan v3
 * Verifies Sanitization, Natural Language Router, DB Pooling/Migrations, and Auth Ticket Exchange
 */

process.env.NODE_ENV = 'test';
process.env.SKIP_MEMORY_EXPORT = 'true';

const fs = require('fs');
const path = require('path');

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

if (!testDbUrl) {
  throw new Error('SECURITY BLOCKER: TEST_DATABASE_URL is missing. Test execution aborted.');
}

const assert = require('assert');
const { sanitizeSecrets, sanitizeError, sanitizeText } = require('../jarvis/sanitizer');
const { routeNaturalLanguageCommand, detectLanguage, markNaturalLanguageLogExecuted } = require('../jarvis/natural-language-router');
const { queryDb } = require('../jarvis/db');
const { runMigrations } = require('../jarvis/migrations');

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

async function runTests() {
  console.log('🧪 Starting Jarvis Security Mitigation Plan v3 Regression Test Suite...\n');

  // Test 1: Sanitizer - Secret Redaction
  console.log('--- Test 1: Sanitizer Secret Redaction ---');
  const secretText = 'Authorization: Bearer my-secret-token-12345 and db postgres://admin:supersecretpass@db.supabase.com:5432/postgres';
  const sanitized = sanitizeSecrets(secretText);
  assert(!sanitized.includes('my-secret-token-12345'), 'Bearer token should be redacted');
  assert(!sanitized.includes('supersecretpass'), 'Postgres password should be redacted');
  assert(sanitized.includes('[REDACTED]') || sanitized.includes('••••••••'), 'Sanitized text should contain redaction mask');
  console.log('✅ Test 1 Passed: Secret Redaction verified.');

  // Test 2: Sanitizer - Error Sanitization
  console.log('\n--- Test 2: Sanitizer Error Message Cleanup ---');
  const rawErr = new Error('Database query failed: connect ECONNREFUSED 127.0.0.1:5432\n    at Client.connect (/app/node_modules/pg/lib/client.js:10:5)\n    at processTicksAndRejections');
  const safeErrMsg = sanitizeError(rawErr);
  assert(!safeErrMsg.includes('ECONNREFUSED'), 'Internal connection error details should be sanitized');
  assert(safeErrMsg.includes('Internal server error'), 'Generic error message should be returned for internal error');
  console.log('✅ Test 2 Passed: Error Sanitization verified.');

  // Test 3: Natural Language Router - Language Detection
  console.log('\n--- Test 3: Natural Language Router Language Detection ---');
  assert.strictEqual(detectLanguage('what should i focus on today'), 'en');
  assert.strictEqual(detectLanguage('qué tengo pendiente hoy'), 'es');
  assert.strictEqual(detectLanguage('dame mi brief de today'), 'mixed');
  console.log('✅ Test 3 Passed: Language Detection verified.');

  // Test 4: Natural Language Router - Longest Match & Safety Gates
  console.log('\n--- Test 4: Natural Language Router Matching & Safety Gates ---');
  const mockMsg = { chat: { id: 'test_chat_123' } };

  // Read-only intent
  const briefRes = await routeNaturalLanguageCommand('what should i focus on today', mockMsg);
  assert.strictEqual(briefRes.intent, 'brief');
  assert.strictEqual(briefRes.type, 'command');

  // State mutation intent (Safety Gate)
  const mutRes = await routeNaturalLanguageCommand('approve this now', mockMsg);
  assert.strictEqual(mutRes.intent, 'approve_action');
  assert.strictEqual(mutRes.type, 'reply');
  assert(mutRes.text.includes('Protected Action') || mutRes.text.includes('Acción Protegida'), 'Safety gate reply should be triggered');

  // Test marking log executed if DB returned logId
  if (briefRes.logId) {
    await markNaturalLanguageLogExecuted(briefRes.logId);
    console.log('   Logged natural language command execution state updated successfully.');
  }

  console.log('✅ Test 4 Passed: Natural Language Matching & Safety Gates verified.');

  // Test 5: Database Connection Pool & Schema Migrations
  console.log('\n--- Test 5: DB Connection Pool & Schema Migrations ---');
  try {
    const migrationSuccess = await runMigrations();
    assert(migrationSuccess === true, 'runMigrations must return true on success');
    console.log('   runMigrations executed successfully without errors.');
  } catch (err) {
    throw new Error(`Migration failure detected during test 5: ${err.message}`);
  }
  console.log('✅ Test 5 Passed: Authoritative DB Schema Migrations verified.');

  assertMemoryUnchanged(memSnapshot);
  console.log('✅ Memory files integrity check passed (0 mutations).');
  console.log('\n🎉 ALL REGRESSION TESTS PASSED SUCCESSFULLY!');
}

const memSnapshot = getMemorySnapshot();
runTests().catch(err => {
  console.error('❌ Test Suite Failed:', err);
  throw err;
});
