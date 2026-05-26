const { appEmitter } = require('../../../lib/events');
const { eventBus } = require('../../queue/queue');
const { getProvider } = require('../../../integrations/providerRegistry');
const { SyncStateMachine } = require('../../sync/syncStateMachine');
const { recordSyncAttempt } = require('../../../lib/idempotency');
const { trackLatency, recordMetric } = require('../../../lib/metrics');
const runtimePreflight = require('../../runtime/runtimePreflight');
const circuitBreakerRegistry = require('../../failover/circuitBreakerRegistry');
const memoryGraph = require('../../memory/memoryGraph');
const { orchestrateAction } = require('../../intelligence/executionPlanner');

appEmitter.on('crm.sync.requested', async (eventData) => {
  const { tenant_id, entity_type, entity_id, event_type, lead_data, provider = 'ghl' } = eventData;
  const startTime = Date.now();
  
  // 1. Initialize State Machine
  const state = new SyncStateMachine('queued');
  
  try {
    // 2. Preflight Evaluation (Centralized Governance)
    const decision = await runtimePreflight.evaluate(eventData);
    await runtimePreflight.logDecision(tenant_id, decision);

    if (!decision.allowed) {
      return await handleNonAllowedSync(tenant_id, eventData, decision, state);
    }

    // 3. Execution (Allowed)
    state.transitionTo('processing');
    await recordSyncAttempt(tenant_id, { ...eventData, idempotency_key: decision.idempotency_key }, 'processing');

    await executeProviderSync(tenant_id, eventData, decision, state, startTime);

  } catch (error) {
    await handleSyncFailure(tenant_id, eventData, error, state);
  }
});

/**
 * Handles syncs that were blocked, deferred, or skipped by preflight.
 */
async function handleNonAllowedSync(tenant_id, eventData, decision, state) {
  const { action, reason } = decision;
  console.log(`[CRM Sync] ${action.toUpperCase()}: ${reason}`);

  if (action === 'defer') {
    state.transitionTo('deferred');
    // Re-publish to queue with delay
    eventData.attempt = (eventData.attempt || 1) + 1;
    await eventBus.publish('crm.sync.requested', eventData, { delay: 60000 }); // Defer by 1 min
  } else if (action === 'skip') {
    state.transitionTo('skipped');
    await recordSyncAttempt(tenant_id, { ...eventData, idempotency_key: decision.idempotency_key }, 'skipped');
  }

  await recordMetric(tenant_id, `sync_${action}`, 1, { reason });
}

/**
 * Actual CRM interaction logic.
 */
async function executeProviderSync(tenant_id, eventData, decision, state, startTime) {
  const { lead_data, provider = 'ghl' } = eventData;
  const { connection_info, idempotency_key } = decision;
  
  // Resolve Provider
  const crm = getProvider(provider, connection_info);
  
  // Sync Contacts
  // Note: We use connection_info.settings for granular feature toggles
  const settings = connection_info.settings || {};
  
  let contactId = null;
  const contactResult = await crm.contactsUpsert(lead_data);
  contactId = contactResult.contact?.id || contactResult.id;

  if (contactId) {
    lead_data.contact_id = contactId;
    
    // Sync Metadata (Notes & Tags)
    await crm.notesCreate({ contact_id: contactId, lead_data });
    await crm.tagsApply({ contact_id: contactId, lead_data });

    // Sync Opportunity (If enabled for tenant)
    if (connection_info.opportunity_sync_enabled) {
      await crm.opportunitiesUpsert(lead_data);
    }

    // Populate Memory Graph
    await memoryGraph.addRelationship(
      `event:${eventData.id || idempotency_key}`,
      `crm:contact:${contactId}`,
      'created_or_updated',
      { tenant_id, provider }
    );
  }

  // Record Success
  circuitBreakerRegistry.recordSuccess({ provider, tenantId: tenant_id });
  state.transitionTo('completed');
  await recordSyncAttempt(tenant_id, { idempotency_key }, 'completed');
  await trackLatency(tenant_id, 'full_sync', startTime);
  await recordMetric(tenant_id, 'sync_success', 1);
}

/**
 * Handles runtime failures during execution.
 */
async function handleSyncFailure(tenant_id, eventData, error, state) {
  const { provider = 'ghl' } = eventData;
  console.error(`[CRM Sync] Error:`, error.message);
  
  state.transitionTo('failed');
  circuitBreakerRegistry.recordFailure({ provider, tenantId: tenant_id });

  // Use Execution Planner to determine next step
  const plan = orchestrateAction('crm.sync.failed', { 
    error: error.message,
    attempts: eventData.attempt || 1,
    priority: eventData.priority || 'medium'
  });

  console.log(`[CRM Sync] Recovery Plan: ${plan.action}`);

  if (plan.action === 'retry') {
    eventData.attempt = (eventData.attempt || 1) + 1;
    await eventBus.publish('crm.sync.requested', eventData, { delay: plan.delay || 5000 });
  } else {
    // Dead letter or skip
    await recordMetric(tenant_id, 'sync_failure', 1, { error: error.message });
    // Additional failure logging...
  }
}
