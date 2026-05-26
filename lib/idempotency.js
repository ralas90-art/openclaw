const { supabase } = require('./supabase');

/**
 * Generates an idempotency key following the format:
 * tenant_id:entity_type:entity_id:event_type
 */
function generateIdempotencyKey(tenant_id, entity_type, entity_id, event_type) {
  return `${tenant_id}:${entity_type}:${entity_id}:${event_type}`;
}

/**
 * Checks if a sync attempt has already been made or completed.
 */
async function checkIdempotency(tenant_id, idempotency_key) {
  if (!supabase) return { should_proceed: true };

  try {
    const { data, error } = await supabase
      .from('sync_idempotency')
      .select('*')
      .eq('tenant_id', tenant_id)
      .eq('idempotency_key', idempotency_key)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows found"
      console.error('Idempotency lookup error:', error.message);
      return { should_proceed: true };
    }

    if (data) {
      if (data.status === 'completed' || data.status === 'processing') {
        return { 
          should_proceed: false, 
          status: data.status, 
          data 
        };
      }
      return { should_proceed: true, existing: data };
    }

    return { should_proceed: true };
  } catch (err) {
    console.error('Idempotency check failed:', err.message);
    return { should_proceed: true };
  }
}

/**
 * Records or updates an idempotency record.
 */
async function recordSyncAttempt(tenant_id, payload, status = 'processing') {
  if (!supabase) return;

  const { entity_type, entity_id, event_type, idempotency_key } = payload;

  try {
    const { data: existing } = await supabase
      .from('sync_idempotency')
      .select('id, replay_count')
      .eq('tenant_id', tenant_id)
      .eq('idempotency_key', idempotency_key)
      .single();

    if (existing) {
      await supabase
        .from('sync_idempotency')
        .update({
          status,
          last_seen_at: new Date().toISOString(),
          replay_count: (existing.replay_count || 0) + 1,
          completed_at: status === 'completed' ? new Date().toISOString() : null
        })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('sync_idempotency')
        .insert([{
          tenant_id,
          entity_type,
          entity_id,
          event_type,
          idempotency_key,
          status,
          first_seen_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          replay_count: 0,
          metadata: payload.metadata || {}
        }]);
    }
  } catch (err) {
    console.error('Failed to record sync attempt:', err.message);
  }
}

module.exports = { generateIdempotencyKey, checkIdempotency, recordSyncAttempt };
