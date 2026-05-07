const { supabase } = require('../integrations/supabase/client');
const { processEvents } = require('../core/events/runtime');
const { emitEvent } = require('../core/events');

const DEMO_TENANT_ID = '62eb5d62-d922-43e1-ae9f-3a347a932bee';

async function test() {
  console.log('🧪 Starting Lead Intelligence Engine V1 Test...');

  // 1. Create a test lead
  console.log('📝 Creating test lead...');
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .insert([
      {
        tenant_id: DEMO_TENANT_ID,
        name: 'John Doe',
        phone: '555-0199',
        email: 'john@example.com',
        source: 'test-script',
        status: 'New',
        metadata: { service_type: 'roofing', notes: 'I have an emergency leak in my kitchen!' }
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
  await emitEvent(DEMO_TENANT_ID, 'lead.created', 'lead', lead.id, {
    source: 'test-script'
  });

  // 3. Run Event Runtime
  console.log('🔄 Running Event Runtime...');
  await processEvents();

  // 4. Verify Lead Intelligence
  console.log('\n🔍 Verifying Lead Intelligence...');
  const { data: intelligence, error: intError } = await supabase
    .from('lead_intelligence')
    .select('*')
    .eq('lead_id', lead.id)
    .single();

  if (intError) {
    console.error(`❌ Lead intelligence not found: ${intError.message}`);
  } else {
    console.log('✅ Lead Intelligence Record Found:');
    console.log(`- Score: ${intelligence.score}`);
    console.log(`- Grade: ${intelligence.grade}`);
    console.log(`- Recommendation: ${intelligence.recommendation}`);
    console.log(`- Outreach Strategy: ${intelligence.outreach_strategy}`);
  }

  // 5. Verify lead.scored event
  const { data: scoredEvent, error: eventError } = await supabase
    .from('event_logs')
    .select('*')
    .eq('event_type', 'lead.scored')
    .eq('lead_id', lead.id)
    .single();

  if (eventError) {
    console.log('❌ lead.scored event not found.');
  } else {
    console.log(`✅ lead.scored event emitted: ${scoredEvent.id}`);
  }

  console.log('\n🏆 Test Complete.');
}

test();
