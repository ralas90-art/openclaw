const { FAILURE_TYPES } = require('./failureClassifier');

function planExecution(event, context) {
  const { priority, failure_type, attempts = 0, retry_cap = 3 } = context;

  // 1. Critical Failure Handling
  if (failure_type === FAILURE_TYPES.AUTH) {
    return { action: 'escalate', reason: 'Authentication failure requires manual fix' };
  }

  // 2. Retry Logic
  if (failure_type === FAILURE_TYPES.TIMEOUT || failure_type === FAILURE_TYPES.NETWORK) {
    if (attempts < retry_cap) {
      return { action: 'retry', delay: Math.pow(2, attempts) * 1000 }; // Exponential backoff
    }
    return { action: 'dead_letter', reason: 'Retry cap reached for transient failure' };
  }

  // 3. Validation / Policy blocks
  if (failure_type === FAILURE_TYPES.VALIDATION || failure_type === FAILURE_TYPES.POLICY) {
    return { action: 'dead_letter', reason: 'Permanent failure - payload or policy issue' };
  }

  // 4. General Default
  if (priority === 'critical') {
    return { action: 'escalate', reason: 'Critical event failed' };
  }

  return { action: 'dead_letter', reason: 'Unknown failure - safeguard' };
}

module.exports = { planExecution };
