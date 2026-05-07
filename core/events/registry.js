/**
 * Cresca OS Event Registry
 * Maps event types to their corresponding handlers.
 */

const handlers = {
  'lead.created': require('./handlers/leadCreated'),
  'lead.scored': require('./handlers/leadScored'),
  'outreach.recommended': require('./handlers/outreachRecommended'),
  'high_value_lead': require('./handlers/highValueLead'),
  'followup.required': require('./handlers/followupRequired'),
  'workflow.started': require('./handlers/workflowStarted'),
  'workflow.completed': require('./handlers/workflowCompleted')
};

function getHandler(eventType) {
  return handlers[eventType] || null;
}

module.exports = { getHandler };
