const FAILURE_TYPES = {
  AUTH: 'auth_failure',
  TIMEOUT: 'provider_timeout',
  VALIDATION: 'validation_failure',
  POLICY: 'policy_block',
  DUPLICATE: 'duplicate_event',
  NETWORK: 'network_failure',
  UNKNOWN: 'unknown_failure'
};

function classifyFailure(error) {
  const message = error.message?.toLowerCase() || '';

  if (message.includes('401') || message.includes('unauthorized') || message.includes('auth')) {
    return FAILURE_TYPES.AUTH;
  }
  if (message.includes('timeout') || message.includes('econnreset')) {
    return FAILURE_TYPES.TIMEOUT;
  }
  if (message.includes('validation') || message.includes('required')) {
    return FAILURE_TYPES.VALIDATION;
  }
  if (message.includes('policy')) {
    return FAILURE_TYPES.POLICY;
  }
  if (message.includes('duplicate') || message.includes('idempotency')) {
    return FAILURE_TYPES.DUPLICATE;
  }
  
  return FAILURE_TYPES.UNKNOWN;
}

module.exports = { classifyFailure, FAILURE_TYPES };
