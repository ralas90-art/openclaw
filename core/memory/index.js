const { supabase } = require('../../integrations/supabase/client');

/**
 * Cresca OS Operational Memory
 * Bridges the gap between agents and the Postgres source of truth.
 */

async function getTenantById(tenantId) {
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', tenantId)
    .single();

  if (error) throw new Error(`Failed to get tenant: ${error.message}`);
  return data;
}

async function listTenants() {
  const { data, error } = await supabase
    .from('tenants')
    .select('id, name, slug');

  if (error) throw new Error(`Failed to list tenants: ${error.message}`);
  return data;
}

async function createLead(tenantId, leadPayload) {
  const { data, error } = await supabase
    .from('leads')
    .insert([{ tenant_id: tenantId, ...leadPayload }])
    .select()
    .single();

  if (error) throw new Error(`Failed to create lead: ${error.message}`);
  return data;
}

async function createLeadIntelligence(tenantId, leadId, intelligencePayload) {
  const { data, error } = await supabase
    .from('lead_intelligence')
    .insert([{ 
      tenant_id: tenantId, 
      lead_id: leadId, 
      ...intelligencePayload 
    }])
    .select()
    .single();

  if (error) throw new Error(`Failed to create lead intelligence: ${error.message}`);
  return data;
}

async function createWorkflowRun(tenantId, workflowName, inputPayload) {
  const { data, error } = await supabase
    .from('workflow_runs')
    .insert([{
      tenant_id: tenantId,
      workflow_name: workflowName,
      input_params: inputPayload,
      status: 'pending'
    }])
    .select()
    .single();

  if (error) throw new Error(`Failed to create workflow run: ${error.message}`);
  return data;
}

async function updateWorkflowRunStatus(workflowRunId, status, outputPayload = {}) {
  const updateData = { status, output_data: outputPayload };
  if (status === 'completed' || status === 'failed') {
    updateData.completed_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('workflow_runs')
    .update(updateData)
    .eq('id', workflowRunId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update workflow status: ${error.message}`);
  return data;
}

module.exports = {
  getTenantById,
  listTenants,
  createLead,
  createLeadIntelligence,
  createWorkflowRun,
  updateWorkflowRunStatus
};
