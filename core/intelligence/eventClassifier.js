const CATEGORIES = {
  INFRASTRUCTURE: 'infrastructure',
  OPERATION: 'operation',
  SECURITY: 'security',
  HEALTH: 'health'
};

function classifyEvent(event, data) {
  if (event.startsWith('crm.')) {
    return { category: CATEGORIES.OPERATION, type: 'sync' };
  }
  if (event.startsWith('queue.')) {
    return { category: CATEGORIES.INFRASTRUCTURE, type: 'queue' };
  }
  if (event.startsWith('provider.')) {
    return { category: CATEGORIES.INFRASTRUCTURE, type: 'provider' };
  }
  if (event.startsWith('agent.')) {
    return { category: CATEGORIES.OPERATION, type: 'agent_activity' };
  }
  if (event.includes('fail') || event.includes('error')) {
    return { category: CATEGORIES.HEALTH, type: 'failure' };
  }
  return { category: CATEGORIES.OPERATION, type: 'general' };
}

module.exports = { classifyEvent, CATEGORIES };
