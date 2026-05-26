const BaseAgent = require('./agentBase');
const { appEmitter } = require('../../lib/events');

class SyncMonitorAgent extends BaseAgent {
  constructor() {
    super('SyncMonitor');
    this.init();
  }

  init() {
    appEmitter.on('ghl.sync.completed', (data) => this.handleSuccess(data));
    appEmitter.on('ghl.sync.failed', (data) => this.handleFailure(data));
  }

  async handleSuccess(data) {
    await this.logActivity(data.tenant_id, 'monitor_sync', 'success', { lead_id: data.lead_id });
  }

  async handleFailure(data) {
    await this.logActivity(data.tenant_id, 'monitor_sync', 'failure', { 
      lead_id: data.lead_id, 
      error: data.error 
    });
    
    // Check for failure spikes (mock logic)
    this.emit('alert.created', {
      tenant_id: data.tenant_id,
      severity: 'medium',
      message: `Sync failure detected for lead ${data.lead_id}`
    });
  }
}

module.exports = new SyncMonitorAgent();
