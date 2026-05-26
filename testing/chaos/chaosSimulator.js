const { appEmitter } = require('../../lib/events');
const runtimeGovernor = require('../../core/coordination/runtimeGovernor');

async function simulateProviderOutage(provider) {
  console.log(`[Chaos] Simulating OUTAGE for ${provider}`);
  appEmitter.emit('provider.tripped', {
    provider,
    severity: 'critical',
    message: `Simulated 5xx spike for ${provider}`,
    failure_spike: true
  });
}

async function simulateLatencySpike(provider, ms) {
  console.log(`[Chaos] Simulating LATENCY SPIKE for ${provider}: ${ms}ms`);
  appEmitter.emit('provider.latency', { provider, latency: ms });
}

async function runChaosTest(scenario) {
  console.log(`--- Starting Chaos Test: ${scenario} ---`);
  
  switch(scenario) {
    case 'provider_collapse':
      await simulateProviderOutage('GHL');
      break;
    case 'queue_flood':
      appEmitter.emit('queue.overload', { queue: 'main', depth: 5000, severity: 'high' });
      break;
    default:
      console.log('Unknown scenario');
  }

  // Check state after 1s
  setTimeout(() => {
    console.log(`[Chaos] Result: Safe Mode is ${runtimeGovernor.isSafeMode() ? 'ON' : 'OFF'}`);
  }, 1000);
}

module.exports = { runChaosTest };
