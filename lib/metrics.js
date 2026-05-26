const { supabase } = require('./supabase');

async function recordMetric(tenant_id, metric_name, value, metadata = {}) {
  console.log(`[Metric] ${metric_name}: ${value}`, JSON.stringify(metadata));

  if (!supabase) return;

  try {
    const { error } = await supabase
      .from('sync_metrics')
      .insert([{
        tenant_id,
        metric_name,
        value,
        metadata,
        created_at: new Date().toISOString()
      }]);

    if (error) throw error;
  } catch (err) {
    console.error('Failed to record metric:', err.message);
  }
}

async function trackLatency(tenant_id, operation, startTime) {
  const endTime = Date.now();
  const latency = endTime - startTime;
  await recordMetric(tenant_id, 'provider_latency', latency, { operation });
}

module.exports = { recordMetric, trackLatency };
