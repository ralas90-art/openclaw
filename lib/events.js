const EventEmitter = require('events');
const { logEvent } = require('./logger');

class AppEmitter extends EventEmitter {}
const appEmitter = new AppEmitter();

// Global handler to log all emitted events
const originalEmit = appEmitter.emit;
appEmitter.emit = function(event, ...args) {
  const [data] = args;
  const tenant_id = data?.tenant_id || 'system';
  
  // Log event to Supabase
  logEvent(tenant_id, event, data);
  
  return originalEmit.apply(appEmitter, [event, ...args]);
};

module.exports = { appEmitter };
