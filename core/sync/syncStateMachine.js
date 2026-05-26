const VALID_STATUSES = [
  'queued',
  'processing',
  'retrying',
  'partial_success',
  'completed',
  'failed',
  'dead_lettered',
  'skipped',
  'cancelled'
];

class SyncStateMachine {
  constructor(initialStatus = 'queued') {
    this.status = initialStatus;
    this.history = [{ status: initialStatus, timestamp: new Date().toISOString() }];
  }

  transitionTo(newStatus) {
    if (!VALID_STATUSES.includes(newStatus)) {
      throw new Error(`Invalid sync status: ${newStatus}`);
    }

    // Logic to prevent invalid transitions (e.g., completed -> processing)
    if (this.isFinalState(this.status) && !this.isReplayable(newStatus)) {
      throw new Error(`Cannot transition from final state ${this.status} to ${newStatus}`);
    }

    this.status = newStatus;
    this.history.push({ status: newStatus, timestamp: new Date().toISOString() });
    return this.status;
  }

  isFinalState(status) {
    return ['completed', 'dead_lettered', 'skipped', 'cancelled'].includes(status);
  }

  isReplayable(newStatus) {
    return newStatus === 'queued' || newStatus === 'processing';
  }

  getStatus() {
    return this.status;
  }

  getHistory() {
    return this.history;
  }
}

module.exports = { SyncStateMachine, VALID_STATUSES };
