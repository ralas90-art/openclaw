async function createOpportunity(client, contactId, connectionInfo, leadData) {
  if (!connectionInfo.opportunity_sync_enabled) {
    console.log('Opportunity sync is disabled for this tenant.');
    return null;
  }

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
    return await client.post('/opportunities/', payload);
  } catch (error) {
    console.error('Error in createOpportunity:', error.message);
    throw error;
  }
}

module.exports = { createOpportunity };
