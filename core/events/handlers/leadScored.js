const { processLeadsScored } = require('../../../engines/speed-to-lead');

/**
 * Handler for lead.scored
 * Triggers speed-to-lead orchestration after a lead has been analyzed.
 */
module.exports = async (event) => {
  const { tenant_id, payload, lead_id } = event;
  const targetLeadId = lead_id || payload.lead_id;
  const intelligenceId = payload.intelligence_id;

  if (!targetLeadId || !intelligenceId) {
    console.warn(`⚠️ Missing data in lead.scored event: lead_id=${targetLeadId}, intelligence_id=${intelligenceId}`);
    return { success: false, error: 'Missing lead_id or intelligence_id' };
  }

  console.log(`[HANDLER] lead.scored: Initiating speed-to-lead for lead ${targetLeadId}`);

  try {
    const result = await processLeadsScored(tenant_id, targetLeadId, intelligenceId);
    return { success: true, result };
  } catch (err) {
    console.error(`❌ Error in lead.scored handler: ${err.message}`);
    throw err;
  }
};
