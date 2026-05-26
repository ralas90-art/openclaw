const STATES = {
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half_open'
};

class CircuitBreaker {
  constructor(providerName, threshold = 5, timeout = 30000) {
    this.providerName = providerName;
    this.threshold = threshold;
    this.timeout = timeout;
    
    this.state = STATES.CLOSED;
    this.failureCount = 0;
    this.lastFailureAt = null;
    this.openedAt = null;
    this.recoveryAttempts = 0;
  }

  async recordSuccess() {
    this.failureCount = 0;
    if (this.state !== STATES.CLOSED) {
      this.state = STATES.CLOSED;
      await this.persistState();
    }
  }

  async recordFailure() {
    this.failureCount++;
    this.lastFailureAt = new Date();

    if (this.state === STATES.CLOSED && this.failureCount >= this.threshold) {
      await this.trip();
    }
  }

  async trip() {
    this.state = STATES.OPEN;
    this.openedAt = new Date();
    console.log(`[CircuitBreaker:${this.providerName}] TRIPPED (Open)`);
    await this.persistState();
  }

  async persistState() {
    const { supabase } = require('../../lib/supabase');
    if (!supabase) return;
    try {
      await supabase.from('provider_health_history').insert([{
        provider: this.providerName,
        status: this.state,
        metadata: { failure_count: this.failureCount },
        created_at: new Date().toISOString()
      }]);
    } catch (err) {
      console.error('[CircuitBreaker] Failed to persist state:', err.message);
    }
  }

  canExecute() {
    if (this.state === STATES.CLOSED) return true;

    if (this.state === STATES.OPEN) {
      const now = new Date();
      if (now - this.openedAt > this.timeout) {
        this.state = STATES.HALF_OPEN;
        this.recoveryAttempts++;
        console.log(`[CircuitBreaker:${this.providerName}] Transitioning to HALF_OPEN`);
        this.persistState(); // Fire and forget
        return true;
      }
      return false;
    }

    if (this.state === STATES.HALF_OPEN) {
      return true; // Test one request
    }

    return false;
  }

  getStatus() {
    return {
      state: this.state,
      failure_count: this.failureCount,
      last_failure_at: this.lastFailureAt,
      opened_at: this.openedAt,
      recovery_attempts: this.recoveryAttempts
    };
  }
}

module.exports = { CircuitBreaker, STATES };
