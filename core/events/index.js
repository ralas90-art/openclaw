const { supabase } = require('../../integrations/supabase/client');

/**
 * Cresca OS Event Integration
 * Handles persistent logging of events into Postgres.
 */

async function emitEvent(tenantId, eventType, entityType, entityId, payload) {
  // 1. Ensure event type exists or just log it
  // In Phase 1, we log directly to event_logs.
  
  const eventLog = {
    tenant_id: tenantId,
    event_type: eventType,
    payload: payload || {},
    metadata: {
      entity_type: entityType,
      entity_id: entityId
    }
  };

  // Link specific IDs if they match known types
  if (entityType === 'lead') eventLog.lead_id = entityId;
  if (entityType === 'workflow_run') eventLog.workflow_run_id = entityId;

  const { data, error } = await supabase
    .from('event_logs')
    .insert([eventLog])
    .select()
    .single();

  if (error) {
    console.error(`❌ Failed to persist event log: ${error.message}`);
    return null;
  }

  console.log(`📡 Event Persisted: ${eventType} for tenant ${tenantId}`);
  return data;
}

/**
 * Log Event (Simplified for handlers)
 */
async function logEvent(tenantId, eventType, handler, status, logs) {
  return await emitEvent(tenantId, eventType, 'system', null, {
    handler,
    status,
    logs
  });
}

module.exports = {
  emitEvent,
  logEvent
};
