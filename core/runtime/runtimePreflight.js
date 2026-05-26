const runtimeGovernor = require('../coordination/runtimeGovernor');
const circuitBreakerRegistry = require('../failover/circuitBreakerRegistry');
const { checkIdempotency, generateIdempotencyKey } = require('../../lib/idempotency');
const { classifyEvent } = require('../intelligence/eventClassifier');
const { calculatePriority } = require('../intelligence/priorityScorer');
const policyEngine = require('../policies/policyEngine');
const { resolveGHLConnection } = require('../../integrations/ghl/connectionResolver');
const { supabase } = require('../../lib/supabase');

class RuntimePreflight {
  async evaluate(context) {
    const { tenant_id, entity_type, entity_id, event_type, provider = 'ghl' } = context;
    const decisions = [];

    // 1. Resolve Tenant Context & Connection
    const connectionInfo = await resolveGHLConnection(tenant_id);
    if (!connectionInfo) {
      return { 
        allowed: false, 
        action: 'skip', 
        reason: 'No active provider connection found',
        metadata: { tenant_id, provider }
      };
    }

    // 2. Intelligence: Classify & Prioritize
    const classification = classifyEvent(event_type, context);
    const { priority, score, reason: priorityReason } = calculatePriority(event_type, context, connectionInfo.tenant_settings);
    
    context.priority = priority;
    context.classification = classification;

    // 3. Idempotency Check
    const idempotencyKey = generateIdempotencyKey(tenant_id, entity_type, entity_id, event_type);
    const { should_proceed, status: existingStatus } = await checkIdempotency(tenant_id, idempotencyKey);
    
    if (!should_proceed) {
      return {
        allowed: false,
        action: 'skip',
        reason: 'Duplicate event detected (Idempotency)',
        metadata: { idempotency_key: idempotencyKey, existing_status: existingStatus }
      };
    }

    // 4. Runtime Governance (Safe Mode)
    const isSafeMode = runtimeGovernor.isSafeMode();
    if (isSafeMode && priority !== 'critical') {
      return {
        allowed: false,
        action: 'defer',
        reason: `System in Safe Mode: ${runtimeGovernor.reason}`,
        metadata: { priority, governor_reason: runtimeGovernor.reason }
      };
    }

    // 5. Provider Health (Circuit Breaker)
    const canExecute = circuitBreakerRegistry.canExecute({ provider, tenantId: tenant_id });
    if (!canExecute) {
      return {
        allowed: false,
        action: 'defer',
        reason: `Provider ${provider} circuit breaker is OPEN or transitioning`,
        metadata: { provider, tenant_id }
      };
    }

    // 6. Policy Engine Evaluation
    const policyResult = policyEngine.evaluate({
      tenant_id,
      event_type,
      priority,
      safe_mode: isSafeMode,
      provider_healthy: canExecute
    });

    if (policyResult && policyResult.action === 'block') {
      return {
        allowed: false,
        action: 'skip',
        reason: `Policy block: ${policyResult.reason}`,
        metadata: { policy_id: policyResult.policy_id }
      };
    }

    // 7. Final Allowed Decision
    return {
      allowed: true,
      action: 'proceed',
      idempotency_key: idempotencyKey,
      connection_info: connectionInfo,
      priority,
      score,
      classification
    };
  }

  async logDecision(tenant_id, decision) {
    if (!supabase) return;
    try {
      await supabase.from('runtime_decisions').insert([{
        tenant_id,
        action: decision.action,
        reason: decision.reason,
        metadata: {
          ...decision.metadata,
          allowed: decision.allowed,
          priority: decision.priority
        },
        created_at: new Date().toISOString()
      }]);

      // Also log policy evaluation if available
      if (decision.metadata?.policy_id) {
        await supabase.from('policy_evaluations').insert([{
          tenant_id,
          event_id: decision.metadata.event_id,
          policy_id: decision.metadata.policy_id,
          decision: decision.action,
          metadata: decision.metadata
        }]);
      }
    } catch (err) {
      console.error('[Preflight] Failed to log decision:', err.message);
    }
  }
}

module.exports = new RuntimePreflight();
