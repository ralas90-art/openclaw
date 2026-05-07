const { supabase } = require('../../integrations/supabase/client');
const { determineStrategy } = require('./strategy');
const { emitEvent } = require('../../core/events');

/**
 * Speed-to-Lead Engine V1
 * Orchestrates response timing and strategy.
 */

async function processLeadsScored(tenantId, leadId, intelligenceId) {
  console.log(`⚡ Speed-to-Lead: Orchestrating response for lead ${leadId}...`);

  // 1. Fetch Lead and Intelligence
  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single();

  const { data: intelligence } = await supabase
    .from('lead_intelligence')
    .select('*')
    .eq('id', intelligenceId)
    .single();

  if (!lead || !intelligence) {
    console.error('❌ Missing lead or intelligence data for speed-to-lead.');
    return;
  }

  // 2. Determine Strategy
  const strategy = determineStrategy(lead, intelligence);
  console.log(`🎯 Strategy Determined: ${strategy.priority} priority via ${strategy.outreach_strategy}`);

  // 3. Create Workflow Run
  const { data: workflowRun, error: workflowError } = await supabase
    .from('workflow_runs')
    .insert([
      {
        tenant_id: tenantId,
        workflow_name: 'speed_to_lead_v1',
        status: 'running',
        input_params: { lead_id: leadId, intelligence_id: intelligenceId },
        output_data: { strategy }
      }
    ])
    .select()
    .single();

  if (workflowError) {
    console.error(`❌ Failed to create workflow run: ${workflowError.message}`);
    return;
  }

  // 4. Emit Events
  
  // Always emit outreach recommended
  await emitEvent(tenantId, 'outreach.recommended', 'lead', leadId, {
    workflow_run_id: workflowRun.id,
    strategy
  });

  // High value lead event
  if (strategy.priority === 'critical' || strategy.priority === 'high') {
    await emitEvent(tenantId, 'high_value_lead', 'lead', leadId, {
      score: intelligence.score,
      grade: intelligence.grade
    });
  }

  // Followup required event
  await emitEvent(tenantId, 'followup.required', 'lead', leadId, {
    due_in_minutes: strategy.recommended_response_time_minutes
  });

  // 5. Update Workflow Run to Completed
  await supabase
    .from('workflow_runs')
    .update({ 
      status: 'completed',
      completed_at: new Date().toISOString()
    })
    .eq('id', workflowRun.id);

  console.log(`✅ Speed-to-Lead orchestration complete for lead ${leadId}`);
  return { workflowRunId: workflowRun.id, strategy };
}

module.exports = { processLeadsScored };
