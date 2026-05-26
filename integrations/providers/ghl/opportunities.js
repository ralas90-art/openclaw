async function upsertOpportunity(client, connectionInfo, leadData) {
  // Check if opportunity already exists to prevent duplicates (Priority 1)
  // We check by contactId and pipelineId
  const contactId = leadData.contact_id;
  
  const payload = {
    pipelineId: connectionInfo.pipeline_id,
    locationId: connectionInfo.location_id,
    contactId: contactId,
    name: `${leadData.first_name} ${leadData.last_name} - Lead`,
    status: 'open',
    pipelineStageId: connectionInfo.default_stage_id,
    monetaryValue: leadData.monetary_value || 0
  };

  try {
    // Basic deduplication check for opportunities
    const existing = await client.get(`/opportunities/`, { contactId });
    if (existing && existing.opportunities && existing.opportunities.length > 0) {
      const opp = existing.opportunities.find(o => o.pipelineId === connectionInfo.pipeline_id);
      if (opp) return opp;
    }

    return await client.post('/opportunities/', payload);
  } catch (error) {
    throw error;
  }
}

module.exports = { upsertOpportunity };
