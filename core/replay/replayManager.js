const { supabase } = require('../../lib/supabase');
const { appEmitter } = require('../../lib/events');
const { logAudit } = require('../../lib/security');

async function replayEvent(event_id, reason, user_id = 'system') {
  if (!supabase) throw new Error('Supabase not initialized');

  try {
    // 1. Fetch original event from dead_letter_events or event_logs
    const { data: event, error } = await supabase
      .from('dead_letter_events')
      .select('*')
      .eq('id', event_id)
      .single();

    if (error || !event) throw new Error(`Event ${event_id} not found in DLQ`);

    // 2. Audit the replay
    await logAudit(event.tenant_id, user_id, 'replay_event', 'event', event_id, { reason });

    // 3. Re-emit the event
    console.log(`[Replay] Re-emitting event ${event.event_type} for tenant ${event.tenant_id}`);
    
    // We increment attempts and set a replay flag
    const payload = {
      ...event.payload,
      is_replay: true,
      original_event_id: event_id,
      attempt: 0 // Reset attempts for a fresh start
    };

    appEmitter.emit(event.event_type, payload);

    return { status: 'replayed', event_id };

  } catch (err) {
    console.error('[Replay] Replay failed:', err.message);
    throw err;
  }
}

async function dryRunReplay(event_id) {
  // Logic to simulate replay without side effects
  return { status: 'dry_run_success', event_id };
}

module.exports = { replayEvent, dryRunReplay };
