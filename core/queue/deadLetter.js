const { supabase } = require('../../lib/supabase');
const { logEvent } = require('../../lib/logger');

async function handleDeadLetter(tenant_id, job, error) {
  console.log(`[Dead Letter] Handling failure for job ${job.id}`);

  if (!supabase) return;

  try {
    const { error: dlError } = await supabase
      .from('dead_letter_events')
      .insert([{
        tenant_id,
        event_type: job.event,
        payload: job.data,
        error_message: error,
        attempts: job.attempts,
        last_attempt_at: new Date().toISOString()
      }]);

    if (dlError) throw dlError;

    // Emit event for Telegram alerting (handled by system-level listener)
    await logEvent(tenant_id, 'queue.dead_letter.created', {
      job_id: job.id,
      event: job.event,
      error
    }, 'error');

  } catch (err) {
    console.error('Failed to write to dead_letter_events:', err.message);
  }
}

module.exports = { handleDeadLetter };
