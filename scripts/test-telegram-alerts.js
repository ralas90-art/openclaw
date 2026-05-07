const { supabase } = require('../integrations/supabase/client');
const { processEvents } = require('../core/events/runtime');
const { emitEvent } = require('../core/events');

const DEMO_TENANT_ID = '62eb5d62-d922-43e1-ae9f-3a347a932bee';

async function test() {
  console.log('🧪 Starting Telegram Alerts Full-Chain Test...');

  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.warn('⚠️ WARNING: Telegram credentials missing in .env. Alerts will be logged but not sent to real Telegram.');
  }

  // 1. Create an urgent test lead
  console.log('📝 Creating urgent test lead...');
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .insert([
      {
        tenant_id: DEMO_TENANT_ID,
        name: 'Urgent Leak (Telegram Test)',
        phone: '555-0000',
        email: 'test@telegram.com',
        source: 'telegram_test',
        status: 'New',
        metadata: { service_type: 'plumbing', notes: 'EMERGENCY: Pipe burst in basement!' }
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
  await emitEvent(DEMO_TENANT_ID, 'lead.created', 'lead', lead.id, { source: 'test-script' });

  // 3. Process Chain
  console.log('\n🔄 Processing Event Chain...');
  
  console.log('Pass 1: lead.created -> lead.scored');
  await processEvents();
  
  console.log('\nPass 2: lead.scored -> outreach.recommended, high_value_lead, followup.required');
  await processEvents();
  
  console.log('\nPass 3: Sending Telegram Alerts...');
  await processEvents();

  // 4. Verify results
  console.log('\n🔍 Verifying System State...');

  const { data: alerts } = await supabase
    .from('event_logs')
    .select('*')
    .eq('event_type', 'telegram.alert_sent');

  console.log(`✅ Telegram Alert Logs Found: ${alerts?.length || 0}`);
  
  alerts?.forEach(alert => {
    console.log(`- Alert for ${alert.payload.message_type}: ${alert.payload.status}`);
  });

  if (alerts && alerts.some(a => a.payload.status === 'success')) {
    console.log('\n✅ SUCCESS: Telegram alerts were sent successfully.');
  } else if (alerts && alerts.length > 0) {
    console.log('\n⚠️ PARTIAL SUCCESS: Alerts were triggered but Telegram delivery failed (check credentials).');
  } else {
    console.log('\n❌ FAILURE: No Telegram alert logs found.');
  }

  console.log('\n🏆 Test Complete.');
}

test();
