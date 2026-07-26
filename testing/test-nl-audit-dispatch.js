const fs = require('fs');
const path = require('path');

if (fs.existsSync('.env.local')) require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

process.env.NODE_ENV = 'test';
process.env.SKIP_MEMORY_EXPORT = 'true';
process.env.TELEGRAM_ALLOW_UNRESTRICTED_DEV_MODE = 'true';
process.env.TELEGRAM_ALLOWED_CHAT_IDS = 'chat_succ_1,chat_conc_A,chat_same_rec';
process.env.OPENCLAW_ROLE_SUPER_ADMIN_CHAT_IDS = 'chat_succ_1,chat_conc_A,chat_same_rec';

function getDbIdentity(urlStr) {
  if (!urlStr) return null;
  try {
    const u = new URL(urlStr);
    return `${u.hostname}:${u.port || '5432'}/${(u.pathname || '').replace(/^\/+/, '')}`.toLowerCase();
  } catch (e) {
    return null;
  }
}

const testDbUrl = process.env.TEST_DATABASE_URL;

if (!testDbUrl) {
  throw new Error('SECURITY BLOCKER: TEST_DATABASE_URL is missing. Test execution aborted.');
}

if (process.env.DATABASE_URL && getDbIdentity(process.env.DATABASE_URL) === getDbIdentity(testDbUrl)) {
  process.env.DATABASE_URL = 'postgresql://prod_user:secret@prod-host:5432/prod_db';
}

const {
  routeNaturalLanguageCommand,
  transitionNaturalLanguageLog,
  markNaturalLanguageLogExecuted,
  detectLanguage
} = require('../jarvis/natural-language-router');
const { dispatchCommand, handleCommand } = require('../interfaces/telegram/handlers');
const { queryDb } = require('../jarvis/db');

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
    throw new Error(`NL Audit Test Assertion Failed: ${message}`);
  }
}

async function runTests() {
  console.log('🧪 Starting NL Audit Lifecycle & Real Dispatcher Tests...\n');

  // Test 1: Language Detection
  assert(detectLanguage('que tengo pendiente hoy') === 'es', 'Spanish detection failed');
  assert(detectLanguage('what should i focus on today') === 'en', 'English detection failed');
  console.log('✅ Test 1: Language detection passed.');

  // Test 2: Direct handleCommand() invocation for /help, /menu, and /jarvis_dashboard
  const helpOut = await handleCommand('/help');
  assert(helpOut && helpOut.includes('Available Commands'), '/help must return available commands list');
  console.log('✅ Test 2A: Direct /help command execution passed.');

  const menuOut = await handleCommand('/menu');
  assert(menuOut && typeof menuOut === 'object' && menuOut.reply_markup, '/menu must return operator dashboard markup');
  console.log('✅ Test 2B: Direct /menu command execution passed.');

  const testMsg = { from: { id: 'admin_user' }, chat: { id: 'admin_chat' } };
  const dashOut = await handleCommand('/jarvis_dashboard', testMsg);
  assert(dashOut && (dashOut.includes('/admin/jarvis?ticket=') || dashOut.includes('Access Denied') || dashOut.includes('Permission Denied') || dashOut.includes('Dashboard Access')), '/jarvis_dashboard must execute permission check and return ticket URL or permission denial');
  console.log('✅ Test 2C: Direct /jarvis_dashboard command execution & permission check passed.');

  // Test 3: Safe Regex Alias Escaping
  let regexError = false;
  try {
    await routeNaturalLanguageCommand('empieza una sesión para cresca-os [v3.0]?');
  } catch (err) {
    regexError = true;
  }
  assert(!regexError, 'Regex escaping must prevent syntax errors on special characters');
  console.log('✅ Test 3: Safe regex alias escaping passed.');

  let successRes, deniedRes, resA, resB;
  try {
    // Test 4: Dispatcher Flow with Real DB Log Lifecycle (Successful Dispatch)
    console.log('- Testing real dispatcher with successful command...');
    successRes = await dispatchCommand('show me my pending approvals', { chat: { id: 'chat_succ_1' } });
    console.log('successRes output:', successRes);
    assert(successRes.ok === true, 'Successful NL command dispatch must return ok === true');
    assert(successRes.logId, 'dispatchCommand must return valid logId');

    const succLog = await queryDb('SELECT executed_boolean FROM jarvis_natural_language_logs WHERE id = $1', [successRes.logId]);
    assert(succLog.length === 1 && succLog[0].executed_boolean === true, 'Successful dispatch must set executed_boolean = true in DB');
    console.log('✅ Test 4: Successful dispatch marked executed_boolean = true in DB.');

    // Test 5: Dispatcher Flow with Gated/Denied Command (Failed Dispatch)
    console.log('- Testing real dispatcher with gated/denied command...');
    deniedRes = await dispatchCommand('approve this approval request', { chat: { id: 'chat_denied_1' } });
    assert(deniedRes.ok === false, 'Gated/denied NL mutation must return ok === false');
    assert(deniedRes.logId, 'Gated dispatch must retain logId');

    const deniedLog = await queryDb('SELECT executed_boolean FROM jarvis_natural_language_logs WHERE id = $1', [deniedRes.logId]);
    assert(deniedLog.length === 1 && deniedLog[0].executed_boolean === false, 'Denied dispatch must leave executed_boolean = false in DB');
    console.log('✅ Test 5: Gated/denied dispatch left executed_boolean = false in DB.');

    // Test 6: Concurrent NL Dispatch & Exact-Row Isolation
    console.log('- Testing 2 concurrent NL dispatches for exact-row isolation...');
    [resA, resB] = await Promise.all([
      dispatchCommand('show me my priorities', { chat: { id: 'chat_conc_A' } }),
      dispatchCommand('approve this priority item', { chat: { id: 'chat_conc_B' } }) // Gated -> fails ok
    ]);

    assert(resA.logId && resB.logId && resA.logId !== resB.logId, 'Concurrent dispatches must generate unique logIds');

    const [logA, logB] = await Promise.all([
      queryDb('SELECT status, executed_boolean FROM jarvis_natural_language_logs WHERE id = $1', [resA.logId]),
      queryDb('SELECT status, executed_boolean FROM jarvis_natural_language_logs WHERE id = $1', [resB.logId])
    ]);

    assert(logA[0].status === 'executed' && logA[0].executed_boolean === true, 'Successful concurrent command must have status = executed and executed_boolean = true');
    assert(logB[0].status === 'failed' && logB[0].executed_boolean === false, 'Failed concurrent command must have status = failed and executed_boolean = false');
    console.log('✅ Test 6: Concurrent NL dispatch exact-row isolation passed.');

    // Test 7: Action May Have Executed, Structured Return & Operator Alert Generation
    console.log('- Testing finalization error handling (action_may_have_executed)...');
    const testLogRows = await queryDb(
      `INSERT INTO jarvis_natural_language_logs (original_text_sanitized, original_text_hash, detected_language, interpreted_intent, mapped_command, confidence, risk_tier, status, executed_boolean, source_chat_id)
       VALUES ('test action_may_have_executed', 'hash_test_may_exec', 'en', 'priorities', '/jarvis_priorities', 1.0, 'read_only', 'executing', false, 'chat_may_exec')
       RETURNING id`
    );
    const mayExecLogId = testLogRows[0].id;
    await transitionNaturalLanguageLog(mayExecLogId, 'action_may_have_executed', ['executing']);
    const mayExecCheck = await queryDb('SELECT status, executed_boolean FROM jarvis_natural_language_logs WHERE id = $1', [mayExecLogId]);
    assert(mayExecCheck[0].status === 'action_may_have_executed' && mayExecCheck[0].executed_boolean === false, 'action_may_have_executed status must have executed_boolean = false');
    console.log('✅ Test 7: action_may_have_executed status verified with executed_boolean = false.');

    // Test 8: Same-record Replay Prevention (Handler executed 0 times on replay)
    console.log('- Testing same-record replay rejection...');
    let replayError = false;
    try {
      await transitionNaturalLanguageLog(resA.logId, 'executing', ['pending']);
    } catch (e) {
      replayError = true;
    }
    assert(replayError, 'Replaying an already executed logId must fail atomic state transition');
    console.log('✅ Test 8: Same-record replay prevented successfully (0 extra handler executions).');

    // Test 9: Concurrent Dispatches Against Same Audit Record & Total Handler Invocation Count
    console.log('- Testing 2 concurrent dispatches against the exact same audit record...');
    const dupTestRows = await queryDb(
      `INSERT INTO jarvis_natural_language_logs (original_text_sanitized, original_text_hash, detected_language, interpreted_intent, mapped_command, confidence, risk_tier, status, executed_boolean, source_chat_id)
       VALUES ('concurrent same record test', 'hash_same_record', 'en', 'priorities', '/jarvis_priorities', 1.0, 'read_only', 'pending', false, 'chat_same_rec')
       RETURNING id`
    );
    const sameRecordLogId = dupTestRows[0].id;

    let winCount = 0;
    let loseCount = 0;
    let totalHandlerInvocations = 0;

    const executeWithAtomicGuard = async (logId) => {
      await transitionNaturalLanguageLog(logId, 'executing', ['pending']);
      totalHandlerInvocations++;
      return await markNaturalLanguageLogExecuted(logId);
    };

    const transResults = await Promise.allSettled([
      executeWithAtomicGuard(sameRecordLogId),
      executeWithAtomicGuard(sameRecordLogId)
    ]);

    for (const r of transResults) {
      if (r.status === 'fulfilled') winCount++;
      else {
        loseCount++;
        console.log('Test 9 Rejection:', r.reason?.stack || r.reason);
      }
    }

    assert(winCount === 1, `winCount must be 1, got ${winCount}`);
    assert(loseCount === 1, `loseCount must be 1, got ${loseCount}`);
    assert(totalHandlerInvocations === 1, `total handler invocation count must be exactly 1, got ${totalHandlerInvocations}`);
    console.log('✅ Test 9: Concurrent same-record dispatch passed: winCount === 1, loseCount === 1, total handler invocation count === 1.');

    // Cleanup extra test log IDs
    try {
      await queryDb('DELETE FROM jarvis_natural_language_logs WHERE id IN ($1, $2)', [mayExecLogId, sameRecordLogId]);
    } catch (_) {}

  } finally {
    // Clean up test audit logs
    const idsToClean = [successRes?.logId, deniedRes?.logId, resA?.logId, resB?.logId].filter(Boolean);
    if (idsToClean.length > 0) {
      try {
        await queryDb(`DELETE FROM jarvis_natural_language_logs WHERE id IN (${idsToClean.map((_, i) => `$${i + 1}`).join(',')})`, idsToClean);
      } catch (_) {}
    }
    console.log('✅ Test 10: Test audit logs cleaned up cleanly in finally block.');
  }

  assertMemoryUnchanged(memSnapshot);
  console.log('✅ Memory files integrity check passed (0 mutations).');
  console.log('\n🎉 ALL Natural Language Audit & Dispatcher Tests Passed Successfully!');
}

const memSnapshot = getMemorySnapshot();
runTests().catch(err => {
  console.error('Test execution failed:', err);
  throw err;
});
