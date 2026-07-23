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
const prodDbUrl = process.env.DATABASE_URL;

if (!testDbUrl) {
  throw new Error('SECURITY BLOCKER: TEST_DATABASE_URL is missing. Test execution aborted.');
}
if (!testDbUrl.includes('test_env=isolated') && !testDbUrl.includes('test')) {
  throw new Error('SECURITY BLOCKER: TEST_DATABASE_URL missing test_env=isolated or test marker. Execution aborted to protect database.');
}
if (prodDbUrl && normalizePgUrl(testDbUrl) === normalizePgUrl(prodDbUrl) && !testDbUrl.includes('test_env=isolated')) {
  throw new Error('SECURITY BLOCKER: TEST_DATABASE_URL matches DATABASE_URL. Execution aborted to protect production database.');
}

process.env.DATABASE_URL = testDbUrl;

const express = require('express');
const http = require('http');
const {
  createAuthTicket,
  validateAndConsumeTicket,
  createSessionToken,
  validateSessionToken,
  safeTimingEqual,
  checkTicketRateLimit
} = require('../jarvis/auth-tickets');
const routes = require('../jarvis/routes');

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
    throw new Error(`Auth Ticket Assertion Failed: ${message}`);
  }
}

async function runTests() {
  console.log('🧪 Starting Auth Ticket & Session Security Integration Tests...\n');

  // Test 1: Timing-safe string equality
  assert(safeTimingEqual('secret-token-123', 'secret-token-123') === true, 'Matching tokens must return true');
  assert(safeTimingEqual('secret-token-123', 'wrong-token-456') === false, 'Mismatched tokens must return false');
  assert(safeTimingEqual('short', 'much-longer-token-string') === false, 'Different length strings must safely return false');
  console.log('✅ Test 1: Timing-safe string comparison passed.');

  // Test 2: Rate Limiting
  const rateId = 'test_ip_123';
  for (let i = 0; i < 5; i++) {
    assert(checkTicketRateLimit(rateId, 10, 60000) === true, 'Requests within limit must succeed');
  }
  console.log('✅ Test 2: Rate limiting check passed.');

  // Test 3: Ticket Issuance
  const ticketId = await createAuthTicket('dashboard_access', { userId: 'usr_123' }, 300);
  assert(typeof ticketId === 'string' && ticketId.length === 64, 'Ticket must be a 64-char hex string');
  console.log('✅ Test 3: Ticket issuance passed.');

  // Test 4: Concurrent Ticket Redemption via Promise.allSettled
  const concTicket = await createAuthTicket('dashboard_access', { userId: 'usr_conc' }, 300);
  const concResults = await Promise.allSettled([
    validateAndConsumeTicket(concTicket, 'dashboard_access'),
    validateAndConsumeTicket(concTicket, 'dashboard_access')
  ]);
  const concValid = concResults.filter(r => r.status === 'fulfilled' && r.value.valid === true);
  const concInvalid = concResults.filter(r => r.status === 'fulfilled' && r.value.valid === false);
  assert(concValid.length === 1, `Exactly 1 concurrent ticket redemption must succeed. Got ${concValid.length}`);
  assert(concInvalid.length === 1, `Exactly 1 concurrent ticket redemption must be rejected. Got ${concInvalid.length}`);
  console.log('✅ Test 4: Concurrent ticket redemption constraint passed.');

  // Test 5: Purpose Mismatch Protection
  const ticketId2 = await createAuthTicket('google_oauth_connect', { connector: 'gmail' }, 300);
  const result3 = await validateAndConsumeTicket(ticketId2, 'wrong_purpose');
  assert(result3.valid === false, 'Validation should fail on purpose mismatch');
  console.log('✅ Test 5: Purpose mismatch protection passed.');

  // Test 6: Expiration Handling
  const expiredTicket = await createAuthTicket('test_expire', {}, 1); // 1 sec TTL
  await new Promise(r => setTimeout(r, 1100)); // wait for expiration
  const result4 = await validateAndConsumeTicket(expiredTicket, 'test_expire');
  assert(result4.valid === false, 'Expired ticket validation must fail');
  console.log('✅ Test 6: TTL expiration passed.');

  // Test 7: Session Token Issuance & Validation
  const sessionTok = await createSessionToken({ role: 'admin' }, 3600);
  assert(sessionTok.startsWith('srv_sess_'), 'Session token must have srv_sess_ prefix');
  const sessValidation = await validateSessionToken(sessionTok);
  assert(sessValidation.valid === true, 'Session token validation must succeed');
  assert(sessValidation.metadata.role === 'admin', 'Session metadata must be preserved');
  console.log('✅ Test 7: Session token creation & validation passed.');

  // Test 8: Native HTTP Route Integration & Token Authorization Test
  console.log('- Running HTTP Route Integration & Query Token Rejection Tests...');
  const app = express();
  app.use(express.json());
  app.use('/api/jarvis', routes);

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/jarvis`;

  try {
    // A. Exchange ticket for session token
    const exchTicket = await createAuthTicket('dashboard_access', { user: 'test_admin' }, 300);
    const exchRes = await fetch(`${baseUrl}/auth/exchange-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: exchTicket })
    });

    assert(exchRes.status === 200, `Ticket exchange must return 200. Got ${exchRes.status}`);
    const exchData = await exchRes.json();
    assert(exchData.session_token && exchData.session_token.startsWith('srv_sess_'), 'Response must contain srv_sess_ session token');
    const derivedToken = exchData.session_token;
    console.log('  - Ticket exchange returned derived session token successfully.');

    // B. Access protected endpoint with derived session token
    const projRes = await fetch(`${baseUrl}/projects`, {
      headers: { 'Authorization': `Bearer ${derivedToken}` }
    });
    assert(projRes.status === 200, `Protected route /projects must accept derived token with 200. Got ${projRes.status}`);
    console.log('  - Protected route /projects accepted derived session token.');

    // C. Replaying ticket fails
    const replayRes = await fetch(`${baseUrl}/auth/exchange-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: exchTicket })
    });
    assert(replayRes.status === 401, `Replaying exchanged ticket must fail with 401. Got ${replayRes.status}`);
    console.log('  - Ticket replay rejected with 401.');

    // D. Query parameter token ?token=... is rejected
    const queryRes = await fetch(`${baseUrl}/projects?token=some_token_here`);
    assert(queryRes.status === 401, `Query parameter ?token=... must be rejected with 401. Got ${queryRes.status}`);
    console.log('  - Raw query token parameter ?token=... rejected with 401.');

    // E. Raw master admin token on dashboard route /projects is rejected with 401
    const masterRes = await fetch(`${baseUrl}/projects`, {
      headers: { 'Authorization': 'Bearer admin-test-token-123' }
    });
    assert(masterRes.status === 401, `Raw master admin token on dashboard route must be rejected with 401. Got ${masterRes.status}`);
    console.log('  - Raw master admin token on dashboard route /projects rejected with 401.');

    // F. Mobile token on dashboard route /projects is rejected with 401 (token-role isolation)
    const mobileRes = await fetch(`${baseUrl}/projects`, {
      headers: { 'Authorization': 'Bearer mob_tok_test_mobile_user' }
    });
    assert(mobileRes.status === 401, `Mobile token on dashboard route must be rejected with 401. Got ${mobileRes.status}`);
    console.log('  - Mobile token on dashboard route /projects rejected with 401.');

    // Test 9: OAuth Callback State Single-Use Ticket & Replay Protection via HTTP
    const stateTicket = await createAuthTicket('oauth_state', { connectorId: 'gmail' }, 600);
    const firstOAuthResult = await validateAndConsumeTicket(stateTicket, 'oauth_state');
    assert(firstOAuthResult.valid === true, 'First OAuth state consumption must succeed');
    const replayOAuthResult = await validateAndConsumeTicket(stateTicket, 'oauth_state');
    assert(replayOAuthResult.valid === false, 'Second OAuth state consumption (replay) must fail');

    // Test HTTP GET callback endpoint with state replay
    const httpStateTicket = await createAuthTicket('oauth_state', { connectorId: 'gmail' }, 600);
    const httpCbRes1 = await fetch(`${baseUrl}/google/callback?code=mock_oauth_code&state=${httpStateTicket}`);
    // First HTTP callback with invalid code will proceed past state check (returns error from google api or 500/400)
    // Replay HTTP callback with same state ticket must be rejected immediately at state check (status 401)
    const httpCbRes2 = await fetch(`${baseUrl}/google/callback?code=mock_oauth_code&state=${httpStateTicket}`);
    assert(httpCbRes2.status === 401, `Replay HTTP callback must be rejected with 401 Unauthorized. Got ${httpCbRes2.status}`);

    console.log('✅ Test 9: OAuth state single-use ticket & replay protection passed.');
  } finally {
    server.close();
  }

  assertMemoryUnchanged(memSnapshot);
  console.log('✅ Memory files integrity check passed (0 mutations).');
  console.log('\n🎉 ALL Auth Ticket & Session Tests Passed Successfully!');
}

const memSnapshot = getMemorySnapshot();
runTests().catch(err => {
  console.error('Test execution failed:', err);
  throw err;
});
