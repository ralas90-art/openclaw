const { appEmitter } = require('../../lib/events');
const { supabase } = require('../../lib/supabase');
const consensusEngine = require('../mesh/agentConsensusEngine');

class RuntimeGovernor {
  constructor() {
    this.safeMode = false;
    this.reason = null;
    this.init();
  }

  init() {
    appEmitter.on('provider.tripped', (data) => this.evaluateSafeMode(data));
    appEmitter.on('queue.overload', (data) => this.evaluateSafeMode(data));
    
    // Listen for consensus results
    appEmitter.on('mesh.consensus.approved', (data) => {
      if (data.action.type === 'enter_safe_mode') {
        this._executeSafeModeEntry(data.action.reason, data.action.manual);
      }
      if (data.action.type === 'exit_safe_mode') {
        this._executeSafeModeExit(data.action.manual);
      }
    });
  }

  async enterSafeMode(reason, manual = false) {
    if (this.safeMode) return;

    // Propose to consensus mesh
    const actionId = `safe_mode_entry_${Date.now()}`;
    await consensusEngine.proposeAction(actionId, { type: 'enter_safe_mode', reason, manual }, 'critical', 'runtime_governor');
    
    console.log(`[RuntimeGovernor] Proposing SAFE MODE entry: ${reason}`);
  }

  async exitSafeMode(manual = false) {
    if (!this.safeMode) return;

    // Propose to consensus mesh
    const actionId = `safe_mode_exit_${Date.now()}`;
    await consensusEngine.proposeAction(actionId, { type: 'exit_safe_mode', manual }, 'critical', 'runtime_governor');
    
    console.log(`[RuntimeGovernor] Proposing SAFE MODE exit`);
  }

  async _executeSafeModeEntry(reason, manual) {
    this.safeMode = true;
    this.reason = reason;
    console.log(`[RuntimeGovernor] EXECUTED SAFE MODE ENTRY: ${reason}`);

    await this.logDecision('enter_safe_mode', { reason, manual });
    appEmitter.emit('runtime.safe_mode.entered', { reason, manual });
  }

  async _executeSafeModeExit(manual) {
    this.safeMode = false;
    this.reason = null;
    console.log(`[RuntimeGovernor] EXECUTED SAFE MODE EXIT`);

    await this.logDecision('exit_safe_mode', { manual });
    appEmitter.emit('runtime.safe_mode.exited', { manual });
  }

  evaluateSafeMode(data) {
    // Auto-trigger logic
    if (data.severity === 'critical' || data.failure_spike) {
      this.enterSafeMode(data.message || 'Systemic instability detected');
    }
  }

  async logDecision(action, metadata) {
    if (!supabase) return;
    try {
      await supabase.from('runtime_decisions').insert([{
        action,
        metadata,
        created_at: new Date().toISOString()
      }]);
    } catch (err) {
      console.error('[RuntimeGovernor] Failed to log decision:', err.message);
    }
  }

  isSafeMode() {
    return this.safeMode;
  }
}

module.exports = new RuntimeGovernor();
