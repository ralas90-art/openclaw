const { CircuitBreaker, STATES } = require('./providerCircuitBreaker');

class ProviderCircuitBreakerRegistry {
  constructor() {
    this.breakers = new Map();
  }

  getBreaker(provider, tenantId = 'global') {
    const key = `${provider}:${tenantId}`;
    if (!this.breakers.has(key)) {
      this.breakers.set(key, new CircuitBreaker(key));
    }
    return this.breakers.get(key);
  }

  canExecute({ provider, tenantId }) {
    // 1. Check global provider health
    const globalBreaker = this.getBreaker(provider, 'global');
    if (!globalBreaker.canExecute()) return false;

    // 2. Check tenant-specific provider health
    const tenantBreaker = this.getBreaker(provider, tenantId);
    return tenantBreaker.canExecute();
  }

  recordSuccess({ provider, tenantId }) {
    this.getBreaker(provider, 'global').recordSuccess();
    this.getBreaker(provider, tenantId).recordSuccess();
  }

  recordFailure({ provider, tenantId }) {
    this.getBreaker(provider, 'global').recordFailure();
    this.getBreaker(provider, tenantId).recordFailure();
  }

  getStatus({ provider, tenantId }) {
    return {
      global: this.getBreaker(provider, 'global').getStatus(),
      tenant: this.getBreaker(provider, tenantId).getStatus()
    };
  }
}

module.exports = new ProviderCircuitBreakerRegistry();
