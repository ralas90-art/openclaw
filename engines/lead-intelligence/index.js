const { supabase } = require('../../integrations/supabase/client');
const { generateScore } = require('./scoring');
const { emitEvent } = require('../../core/events');

/**
 * Lead Intelligence Engine V1
 * Analyzes leads and persists intelligence.
 */

async function analyzeLead(tenantId, leadId) {
  console.log(`🧠 Analyzing lead ${leadId} for tenant ${tenantId}...`);

  // 1. Fetch Lead Data
  const { data: lead, error: fetchError } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single();

  if (fetchError || !lead) {
    console.error(`❌ Failed to fetch lead: ${fetchError?.message || 'Not found'}`);
    return;
  }

  // 2. Generate Score (V1: Deterministic)
  const intelligence = generateScore(lead);
  console.log(`📊 Score Generated: ${intelligence.score} (${intelligence.grade})`);

  // 3. Persist Lead Intelligence
  const { data: savedInt, error: saveError } = await supabase
    .from('lead_intelligence')
    .insert([
      {
        tenant_id: tenantId,
        lead_id: leadId,
        ai_score: Math.round(intelligence.score / 10),
        score: intelligence.score, // Requires migration 003
        grade: intelligence.grade, // Requires migration 003
        insight: intelligence.recommendation,
        recommendation: intelligence.recommendation, // Requires migration 003
        outreach_angle: intelligence.outreach_angle,
        analysis_payload: { flags: intelligence.flags }
      }
    ])
    .select()
    .single();

  if (saveError) {
    console.error(`❌ Failed to save lead intelligence: ${saveError.message}`);
    return;
  }

  // 4. Emit lead.scored event
  await emitEvent(tenantId, 'lead.scored', 'lead', leadId, {
    intelligence_id: savedInt.id,
    score: intelligence.score,
    grade: intelligence.grade
  });

  console.log(`✅ Lead Intelligence persistent and lead.scored emitted.`);
  return savedInt;
}

module.exports = { analyzeLead };
