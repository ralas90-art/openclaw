const { supabase } = require('../../lib/supabase');

/**
 * Generates an executive weekly report aggregating runtime metrics.
 */
async function generate(tenant_id = null, start_date = null, end_date = null) {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const startDateStr = start_date || oneWeekAgo.toISOString();
  const endDateStr = end_date || new Date().toISOString();

  if (!supabase) {
    return {
      report_date: new Date().toISOString(),
      period: 'Last 7 Days',
      status: 'Offline',
      metrics: { total_tenants: 0, events_processed: 0, events_failed: 0, success_rate: 'N/A', new_dead_letters: 0, active_incidents: 0 }
    };
  }

  let tCountQuery = supabase.from('tenants').select('*', { count: 'exact', head: true });
  if (tenant_id) tCountQuery = tCountQuery.eq('id', tenant_id);
  const { count: tenantCount, error: tenantError } = await tCountQuery;
  if (tenantError) console.error("Error fetching tenants for report:", tenantError);

  let eventsProcessedQuery = supabase.from('event_logs')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startDateStr)
    .lte('created_at', endDateStr)
    .eq('status', 'processed');
  if (tenant_id) eventsProcessedQuery = eventsProcessedQuery.eq('tenant_id', tenant_id);
  const { count: eventsProcessed, error: eventsError } = await eventsProcessedQuery;
  if (eventsError) console.error("Error fetching event logs for report:", eventsError);

  let eventsFailedQuery = supabase.from('event_logs')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startDateStr)
    .lte('created_at', endDateStr)
    .eq('status', 'failed');
  if (tenant_id) eventsFailedQuery = eventsFailedQuery.eq('tenant_id', tenant_id);
  const { count: eventsFailed, error: failedError } = await eventsFailedQuery;
  if (failedError) console.error("Error fetching failed events for report:", failedError);

  let deadLettersQuery = supabase.from('dead_letter_events')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startDateStr)
    .lte('created_at', endDateStr);
  if (tenant_id) deadLettersQuery = deadLettersQuery.eq('tenant_id', tenant_id);
  const { count: deadLetters, error: dlqError } = await deadLettersQuery;
  if (dlqError) console.error("Error fetching dead letters for report:", dlqError);

  let incidentsQuery = supabase.from('runtime_incidents')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'open');
  // runtime_incidents might not have tenant_id depending on the schema, but if it does:
  // if (tenant_id) incidentsQuery = incidentsQuery.eq('tenant_id', tenant_id);
  const { count: activeIncidents, error: incError } = await incidentsQuery;
  if (incError) console.error("Error fetching incidents for report:", incError);

  const totalEvents = (eventsProcessed || 0) + (eventsFailed || 0);
  const successRate = totalEvents > 0 ? ((eventsProcessed / totalEvents) * 100).toFixed(2) + '%' : 'N/A';

  return {
    report_date: new Date().toISOString(),
    period_start: startDateStr,
    period_end: endDateStr,
    tenant_filter: tenant_id || 'All',
    metrics: {
      total_tenants: tenantCount || 0,
      events_processed: eventsProcessed || 0,
      events_failed: eventsFailed || 0,
      success_rate: successRate,
      new_dead_letters: deadLetters || 0,
      active_incidents: activeIncidents || 0
    },
    status: (eventsFailed > 50 || activeIncidents > 5) ? 'Needs Attention' : 'Healthy'
  };
}

module.exports = { generate };
