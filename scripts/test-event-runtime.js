const { supabase } = require('../integrations/supabase/client');
const { processEvents } = require('../core/events/runtime');

const DEMO_TENANT_ID = '62eb5d62-d922-43e1-ae9f-3a347a932bee';

async function test() {
  console.log('🧪 Starting Event Runtime Test...');

  // 1. Create a test event
  console.log('📡 Creating test event: lead.created');
  const { data: event, error: createError } = await supabase
    .from('event_logs')
    .insert([
      {
        tenant_id: DEMO_TENANT_ID,
        event_type: 'lead.created',
        payload: { name: 'Test Lead', source: 'Manual' },
        status: 'pending'
      }
    ])
    .select()
    .single();

  if (createError) {
    console.error(`❌ Failed to create test event: ${createError.message}`);
    return;
  }

  console.log(`✅ Test event created: ${event.id}`);

  // 2. Run the runtime
  await processEvents();

  // 3. Verify processing
  const { data: updatedEvent, error: fetchError } = await supabase
    .from('event_logs')
    .select('status, processed_at, error_message')
    .eq('id', event.id)
    .single();

  if (fetchError) {
    console.error(`❌ Failed to verify event: ${fetchError.message}`);
    return;
  }

  console.log('\n📊 Test Summary:');
  console.log(`Event ID: ${event.id}`);
  console.log(`Final Status: ${updatedEvent.status}`);
  
  if (updatedEvent.status === 'completed') {
    console.log('✅ SUCCESS: Event runtime correctly routed and processed the event.');
  } else {
    console.log(`❌ FAILURE: Event status is ${updatedEvent.status}. Error: ${updatedEvent.error_message || 'None'}`);
  }
}

test();
