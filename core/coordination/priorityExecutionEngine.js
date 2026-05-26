const runtimeGovernor = require('./runtimeGovernor');

function resolveExecutionPriority(tenantInfo, eventType, providerState) {
  let priority = 10; // Normal

  if (tenantInfo.tier === 'enterprise') {
    priority += 20;
  }

  if (eventType === 'crm.critical_sync') {
    priority += 30;
  }

  if (runtimeGovernor.isSafeMode()) {
    // In safe mode, only high priority gets through
    return priority > 40 ? priority : 0; // 0 means suppress
  }

  return priority;
}

function shouldExecute(priority) {
  if (runtimeGovernor.isSafeMode()) {
    return priority > 50; // Very strict in safe mode
  }
  return priority > 0;
}

module.exports = { resolveExecutionPriority, shouldExecute };
