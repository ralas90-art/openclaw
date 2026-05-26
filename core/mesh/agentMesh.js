const { appEmitter } = require('../../lib/events');

class AgentMesh {
  constructor() {
    this.agents = new Map();
    this.init();
  }

  init() {
    // Listen for agent heartbeats or registration
    appEmitter.on('agent.registered', (data) => this.registerAgent(data));
  }

  registerAgent(data) {
    this.agents.set(data.agent, {
      id: data.agent,
      type: data.type,
      status: 'active',
      lastSeen: new Date()
    });
    console.log(`[AgentMesh] Registered: ${data.agent}`);
  }

  getAgentsByType(type) {
    return Array.from(this.agents.values()).filter(a => a.type === type);
  }

  broadcast(event, data) {
    appEmitter.emit(`mesh.${event}`, data);
  }
}

module.exports = new AgentMesh();
