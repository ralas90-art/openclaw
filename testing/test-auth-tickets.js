/**
 * Single-Use Cryptographic Auth Tickets Test Suite
 * Verifies ticket creation, single-use redemption, replay rejection, purpose enforcement,
 * timing-safe string comparison, rate limiting, and session token generation.
 * Exits non-zero on failure.
 */

const {
  createAuthTicket,
  validateAndConsumeTicket,
  createSessionToken,
  validateSessionToken,
  safeTimingEqual,
  checkTicketRateLimit
} = require('../jarvis/auth-tickets');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ Assertion failed: ${message}`);
    process.exit(1);
  }
}

async function runTests() {
  console.log('🧪 Starting Auth Ticket & Session Security Tests...\n');

  // Test 1: Buffer-length guarded timing-safe string equality
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

  // Test 4: Successful Validation & Consumption
  const result1 = await validateAndConsumeTicket(ticketId, 'dashboard_access');
  assert(result1.valid === true, 'Ticket validation should succeed on first use');
  assert(result1.metadata.userId === 'usr_123', 'Metadata must be preserved');
  console.log('✅ Test 4: Single-use consumption passed.');

  // Test 5: Replay Rejection
  const result2 = await validateAndConsumeTicket(ticketId, 'dashboard_access');
  assert(result2.valid === false, 'Replaying consumed ticket must be rejected');
  console.log('✅ Test 5: Replay rejection passed.');

  // Test 6: Purpose Mismatch Protection
  const ticketId2 = await createAuthTicket('google_oauth_connect', { connector: 'gmail' }, 300);
  const result3 = await validateAndConsumeTicket(ticketId2, 'wrong_purpose');
  assert(result3.valid === false, 'Validation should fail on purpose mismatch');
  console.log('✅ Test 6: Purpose mismatch protection passed.');

  // Test 7: Expiration Handling
  const expiredTicket = await createAuthTicket('test_expire', {}, 1); // 1 sec TTL
  await new Promise(r => setTimeout(r, 1100)); // wait for expiration
  const result4 = await validateAndConsumeTicket(expiredTicket, 'test_expire');
  assert(result4.valid === false, 'Expired ticket validation must fail');
  console.log('✅ Test 7: TTL expiration passed.');

  // Test 8: Session Token Issuance & Validation
  const sessionTok = await createSessionToken({ role: 'admin' }, 3600);
  assert(sessionTok.startsWith('srv_sess_'), 'Session token must have expected prefix');
  const sessValidation = await validateSessionToken(sessionTok);
  assert(sessValidation.valid === true, 'Session token validation must succeed');
  assert(sessValidation.metadata.role === 'admin', 'Session metadata must be preserved');
  console.log('✅ Test 8: Session token creation & validation passed.');

  console.log('\n🎉 ALL Auth Ticket & Session Tests Passed Successfully!');
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
