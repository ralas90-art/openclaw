const { supabase } = require('../../lib/supabase');
const { logEvent } = require('../../lib/logger');

async function resolveGHLConnection(tenant_id) {
  if (!supabase) {
    console.warn('Supabase not initialized, using environment variables for GHL connection.');
    return {
      location_id: process.env.GHL_LOCATION_ID,
      api_key: process.env.GHL_API_KEY,
      access_token: process.env.GHL_ACCESS_TOKEN,
      pipeline_id: process.env.GHL_PIPELINE_ID,
      default_stage_id: process.env.GHL_STAGE_ID,
      opportunity_sync_enabled: process.env.GHL_OPPORTUNITY_SYNC === 'true'
    };
  }

  try {
    // 1. Fetch connection details
    const { data: connection, error: connError } = await supabase
      .from('integration_connections')
      .select('*')
      .eq('tenant_id', tenant_id)
      .eq('provider', 'ghl')
      .eq('enabled', true)
      .single();

    if (connError || !connection) {
      await logEvent(tenant_id, 'ghl.sync.skipped', { reason: 'No active GHL connection found' });
      return null;
    }

    // 2. Fetch tenant settings for opportunity sync toggle
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('settings')
      .eq('id', tenant_id)
      .single();

    const settings = connection.settings || {};
    const tenantSettings = tenant?.settings || {};

    return {
      location_id: settings.location_id,
      api_key: settings.api_key,
      access_token: settings.access_token,
      pipeline_id: settings.pipeline_id,
      default_stage_id: settings.default_stage_id,
      opportunity_sync_enabled: tenantSettings.opportunity_sync_enabled === true
    };
  } catch (err) {
    console.error('Error resolving GHL connection:', err.message);
    return null;
  }
}

module.exports = { resolveGHLConnection };
