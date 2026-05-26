const { appEmitter } = require('../../lib/events');
const { supabase } = require('../../lib/supabase');

class BaseAgent {
  constructor(name) {
    this.name = name;
  }

  async logActivity(tenant_id, action, status, metadata = {}) {
    console.log(`[Agent:${this.name}] ${action}: ${status}`);

    if (!supabase) return;

    try {
      await supabase
        .from('agent_activity_logs')
        .insert([{
          tenant_id,
          agent_name: this.name,
          action,
          status,
          metadata,
          created_at: new Date().toISOString()
        }]);
    } catch (err) {
      console.error(`[Agent:${this.name}] Failed to log activity:`, err.message);
    }
  }

  emit(event, data) {
    appEmitter.emit(`agent.${event}`, {
      agent: this.name,
      ...data,
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = BaseAgent;
