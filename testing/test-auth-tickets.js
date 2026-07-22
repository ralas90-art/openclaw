/**
 * Single-Use Cryptographic Auth Tickets & Integration Test Suite
 * Verifies ticket creation, single-use redemption, replay rejection, purpose enforcement,
 * timing-safe string comparison, rate limiting, session token generation, concurrent ticket redemption via Promise.allSettled,
 * and rejection of raw query tokens.
 * Exits non-zero on failure.
 */

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

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ Auth Ticket Assertion Failed: ${message}`);
    process.exit(1);
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
      headers: { 'Authorization': 'Bearer mobile_test_token' }
    });
    assert(mobileRes.status === 401, `Mobile token on admin dashboard route must be rejected with 401. Got ${mobileRes.status}`);
    console.log('  - Mobile token on admin dashboard route /projects rejected with 401.');
  } finally {
    server.close();
  }

  console.log('\n🎉 ALL Auth Ticket & Session Tests Passed Successfully!');
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
