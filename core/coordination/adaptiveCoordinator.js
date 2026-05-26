const runtimeGovernor = require('./runtimeGovernor');

function getRetryDelay(attempts, baseDelay = 1000) {
  let delay = Math.pow(2, attempts) * baseDelay;
  
  if (runtimeGovernor.isSafeMode()) {
    delay *= 5; // Conservative backoff in safe mode
  }

  return delay;
}

function getConcurrencyLimit(providerState) {
  if (runtimeGovernor.isSafeMode()) return 1;
  
  switch (providerState) {
    case 'degraded': return 2;
    case 'unstable': return 1;
    case 'healthy': return 10;
    default: return 5;
  }
}

module.exports = { getRetryDelay, getConcurrencyLimit };
