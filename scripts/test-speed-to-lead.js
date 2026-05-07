const { supabase } = require('../integrations/supabase/client');
const { processEvents } = require('../core/events/runtime');
const { emitEvent } = require('../core/events');

const DEMO_TENANT_ID = '62eb5d62-d922-43e1-ae9f-3a347a932bee';

async function test() {
  console.log('🧪 Starting Speed-to-Lead Engine V1 Full-Chain Test...');

  // 1. Create a high-value test lead
  console.log('📝 Creating high-value test lead...');
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .insert([
      {
        tenant_id: DEMO_TENANT_ID,
        name: 'Urgent Customer',
        phone: '555-9111',
        email: 'urgent@example.com',
        source: 'landing_page',
        status: 'New',
        metadata: { service_type: 'emergency_leak', notes: 'WATER EVERYWHERE NOW' }
      }
    ])
    .select()
    .single();

  if (leadError) {
    console.error(`❌ Failed to create lead: ${leadError.message}`);
    return;
  }

  console.log(`✅ Lead created: ${lead.id}`);

  // 2. Emit lead.created event
  console.log('📡 Emitting lead.created event...');
  await emitEvent(DEMO_TENANT_ID, 'lead.created', 'lead', lead.id, { source: 'test-script' });

  // 3. First Pass: Process lead.created (Triggers Lead Intelligence)
  console.log('\n🔄 Pass 1: Processing lead.created...');
  await processEvents();

  // 4. Second Pass: Process lead.scored (Triggers Speed-to-Lead)
  console.log('\n🔄 Pass 2: Processing lead.scored...');
  await processEvents();

  // 5. Verify Results
  console.log('\n🔍 Verifying Final System State...');

  // Check Workflow Runs
  const { data: workflowRun } = await supabase
    .from('workflow_runs')
    .select('*')
    .eq('tenant_id', DEMO_TENANT_ID)
    .eq('workflow_name', 'speed_to_lead_v1')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (workflowRun) {
    console.log(`✅ Workflow Run Found: ${workflowRun.id} (Status: ${workflowRun.status})`);
    console.log('📊 Operational Recommendations:', JSON.stringify(workflowRun.output_data.strategy, null, 2));
  } else {
    console.log('❌ Speed-to-Lead workflow_run not found.');
  }

  // Check Events Emitted
  const { data: events } = await supabase
    .from('event_logs')
    .select('event_type')
    .eq('lead_id', lead.id);

  const eventTypes = events.map(e => e.event_type);
  console.log('\n📡 Events sequence:', eventTypes.join(' -> '));

  if (eventTypes.includes('outreach.recommended')) console.log('✅ outreach.recommended emitted');
  if (eventTypes.includes('high_value_lead')) console.log('✅ high_value_lead emitted (Confirmed High Priority)');
  if (eventTypes.includes('followup.required')) console.log('✅ followup.required emitted');

  console.log('\n🏆 Full-Chain Test Complete.');
}

test();
