/**
 * Single-Use Cryptographic Auth Tickets Test Suite
 * Verifies ticket creation, single-use redemption, replay rejection, purpose enforcement, and TTL expiration.
 */

const { createAuthTicket, validateAndConsumeTicket, cleanupExpiredTickets } = require('../jarvis/auth-tickets');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ Assertion failed: ${message}`);
    process.exit(1);
  }
}

async function runTests() {
  console.log('🧪 Starting Auth Ticket Security Tests...\n');

  // Test 1: Ticket Issuance
  const ticketId = await createAuthTicket('dashboard_access', { userId: 'usr_123' }, 300);
  assert(typeof ticketId === 'string' && ticketId.length === 64, 'Ticket must be a 64-char hex string');
  console.log('✅ Test 1: Ticket issuance passed.');

  // Test 2: Successful Validation & Consumption
  const result1 = await validateAndConsumeTicket(ticketId, 'dashboard_access');
  assert(result1.valid === true, 'Ticket validation should succeed on first use');
  assert(result1.metadata.userId === 'usr_123', 'Metadata must be preserved');
  console.log('✅ Test 2: Single-use consumption passed.');

  // Test 3: Replay Rejection
  const result2 = await validateAndConsumeTicket(ticketId, 'dashboard_access');
  assert(result2.valid === false, 'Replaying consumed ticket must be rejected');
  assert(result2.reason.includes('already been used') || result2.reason.includes('replay'), 'Reason should indicate ticket consumed');
  console.log('✅ Test 3: Replay rejection passed.');

  // Test 4: Purpose Mismatch
  const ticketId2 = await createAuthTicket('google_oauth_connect', { state: 'abc' }, 300);
  const result3 = await validateAndConsumeTicket(ticketId2, 'wrong_purpose');
  assert(result3.valid === false, 'Validation should fail on purpose mismatch');
  console.log('✅ Test 4: Purpose mismatch protection passed.');

  // Test 5: Expiration Handling
  const expiredTicket = await createAuthTicket('test_expire', {}, 1); // 1 sec TTL
  await new Promise(r => setTimeout(r, 1100)); // wait for expiration
  const result4 = await validateAndConsumeTicket(expiredTicket, 'test_expire');
  assert(result4.valid === false, 'Expired ticket validation must fail');
  console.log('✅ Test 5: TTL expiration passed.');

  console.log('\n🎉 ALL Auth Ticket Tests Passed Successfully!');
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
