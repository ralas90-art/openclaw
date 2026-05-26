const runtimePreflight = require('../core/runtime/runtimePreflight');
const runtimeGovernor = require('../core/coordination/runtimeGovernor');
const circuitBreakerRegistry = require('../core/failover/circuitBreakerRegistry');
const policyEngine = require('../core/policies/policyEngine');
const { appEmitter } = require('../lib/events');

// MOCK DATA
const testContext = {
  tenant_id: 'test-tenant-123',
  entity_type: 'contact',
  entity_id: 'lead-456',
  event_type: 'crm.sync.requested',
  provider: 'ghl',
  lead_data: { name: 'John Doe', email: 'john@example.com' }
};

async function runTests() {
  console.log('🚀 Starting Phase 4.5 Runtime Wiring Validation...\n');

  // Test 1: Normal Flow
  console.log('Test 1: Normal Flow (Allowed)');
  const res1 = await runtimePreflight.evaluate(testContext);
  console.log(`- Result: ${res1.allowed ? '✅ PASS' : '❌ FAIL'} (${res1.action})`);

  // Test 2: Safe Mode
  console.log('\nTest 2: Safe Mode (Deferred)');
  await runtimeGovernor.enterSafeMode('Testing Safe Mode');
  // Since consensus is async, we manually trigger the execution for the test
  runtimeGovernor.safeMode = true; 
  
  const res2 = await runtimePreflight.evaluate(testContext);
  console.log(`- Result: ${!res2.allowed && res2.action === 'defer' ? '✅ PASS' : '❌ FAIL'} (${res2.action}: ${res2.reason})`);
  
  runtimeGovernor.safeMode = false; // Reset

  // Test 3: Circuit Breaker Open
  console.log('\nTest 3: Circuit Breaker Open (Deferred)');
  const breaker = circuitBreakerRegistry.getBreaker('ghl', 'test-tenant-123');
  for (let i = 0; i < 6; i++) breaker.recordFailure(); // Trip it
  
  const res3 = await runtimePreflight.evaluate(testContext);
  console.log(`- Result: ${!res3.allowed && res3.action === 'defer' ? '✅ PASS' : '❌ FAIL'} (${res3.action}: ${res3.reason})`);
  
  breaker.recordSuccess(); // Reset

  // Test 4: Policy Block
  console.log('\nTest 4: Policy Block (Skipped)');
  policyEngine.registerPolicy({
    id: 'block_test',
    evaluate: (ctx) => ctx.tenant_id === 'test-tenant-123' ? { action: 'block', reason: 'Blocked for testing' } : null
  });

  const res4 = await runtimePreflight.evaluate(testContext);
  console.log(`- Result: ${!res4.allowed && res4.action === 'skip' ? '✅ PASS' : '❌ FAIL'} (${res4.action}: ${res4.reason})`);

  // Test 5: Replay Logic
  console.log('\nTest 5: Replay Requires Confirm Flag');
  const { handleCommand } = require('../interfaces/telegram/handlers');
  const replayRes1 = await handleCommand('/replay', ['evt-123']);
  const replayRes2 = await handleCommand('/replay', ['evt-123', '--confirm', 'testing']);
  console.log(`- Result: ${replayRes1.includes('Usage:') && replayRes2.includes('Replay failed') ? '✅ PASS' : '❌ FAIL'} (Enforces confirm flag)`);

  // Test 6: Consensus Logging
  console.log('\nTest 6: Consensus Engine Logging');
  const consensusEngine = require('../core/mesh/agentConsensusEngine');
  await consensusEngine.proposeAction('test-action-1', { type: 'test' }, 'moderate', 'agent-1');
  await consensusEngine.recordVote('test-action-1', 'agent-2', true, 'Test vote');
  console.log(`- Result: ✅ PASS (Proposal and vote executed without crashing)`);

  console.log('\n--- Validation Complete ---');
}

runTests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
