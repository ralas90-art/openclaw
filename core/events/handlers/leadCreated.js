const { analyzeLead } = require('../../../engines/lead-intelligence');

/**
 * Handler for lead.created
 * Orchestrates the initial processing of a new lead.
 */
module.exports = async (event) => {
  const { tenant_id, payload, lead_id } = event;
  const targetLeadId = lead_id || payload.lead_id;

  if (!targetLeadId) {
    console.warn('⚠️ No lead_id found in lead.created event.');
    return { success: false, error: 'Missing lead_id' };
  }

  console.log(`[HANDLER] lead.created: Initializing intelligence for lead ${targetLeadId}`);

  try {
    // 1. Trigger Lead Intelligence Engine V1
    const intelligence = await analyzeLead(tenant_id, targetLeadId);

    return { 
      success: true, 
      message: 'Lead intelligence initialized',
      intelligence_id: intelligence?.id 
    };
  } catch (err) {
    console.error(`❌ Error in lead.created handler: ${err.message}`);
    throw err; // Runtime will catch and mark event as failed
  }
};
