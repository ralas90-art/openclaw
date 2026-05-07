const EventEmitter = require('eventemitter3');

/**
 * Cresca OS Central Event Bus
 * All components must use this bus to communicate.
 */
class EventBus extends EventEmitter {
  constructor() {
    super();
    console.log('🚀 Cresca OS Event Bus Initialized');
  }

  /**
   * Publish an event to the system
   * @param {string} topic - e.g. 'lead'
   * @param {string} action - e.g. 'found'
   * @param {object} tenant - { id: '...' }
   * @param {object} payload - The data
   */
  emitEvent(topic, action, tenant, payload) {
    const event = {
      event_id: crypto.randomUUID(),
      tenant_id: tenant.id,
      timestamp: new Date().toISOString(),
      topic,
      action,
      payload,
      metadata: {
        version: '1.0'
      }
    };

    console.log(`[EVENT] ${topic}.${action} for tenant ${tenant.id}`);
    this.emit(`${topic}.${action}`, event);
  }
}

module.exports = new EventBus();
