const { supabase } = require('./supabase');

async function logEvent(tenant_id, event_type, details = {}, level = 'info') {
  console.log(`[${level.toUpperCase()}] ${event_type}:`, JSON.stringify(details));

  if (!supabase) return;

  try {
    const { error } = await supabase
      .from('event_logs')
      .insert([
        {
          tenant_id,
          event_type,
          details,
          level,
          created_at: new Date().toISOString()
        }
      ]);

    if (error) throw error;
  } catch (err) {
    console.error('Failed to write to event_logs:', err.message);
  }
}

async function logWorkflowRun(tenant_id, workflow_name, status, metadata = {}) {
  if (!supabase) return;

  try {
    const { error } = await supabase
      .from('workflow_runs')
      .insert([
        {
          tenant_id,
          workflow_name,
          status,
          metadata,
          created_at: new Date().toISOString()
        }
      ]);

    if (error) throw error;
  } catch (err) {
    console.error('Failed to write to workflow_runs:', err.message);
  }
}

module.exports = { logEvent, logWorkflowRun };
