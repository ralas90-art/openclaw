const { supabase } = require('../../integrations/supabase/client');
const { getHandler } = require('./registry');

/**
 * Cresca OS Event Runtime
 * Processes pending events from Postgres and routes them to handlers.
 */

async function processEvents() {
  console.log('🔄 Checking for pending events...');

  // 1. Fetch pending events
  const { data: events, error: fetchError } = await supabase
    .from('event_logs')
    .select('*')
    .eq('status', 'pending')
    .limit(10);

  if (fetchError) {
    console.error(`❌ Failed to fetch events: ${fetchError.message}`);
    return;
  }

  if (!events || events.length === 0) {
    console.log('💤 No pending events found.');
    return;
  }

  console.log(`🚀 Processing ${events.length} events...`);

  for (const event of events) {
    try {
      // 2. Mark as processing
      await supabase
        .from('event_logs')
        .update({ status: 'processing' })
        .eq('id', event.id);

      // 3. Get handler
      const handler = getHandler(event.event_type);
      
      if (!handler) {
        console.warn(`⚠️ No handler found for event type: ${event.event_type}`);
        await supabase
          .from('event_logs')
          .update({ 
            status: 'failed', 
            error_message: 'No handler registered',
            processed_at: new Date().toISOString()
          })
          .eq('id', event.id);
        continue;
      }

      // 4. Run handler
      const result = await handler(event);

      // 5. Mark as completed
      await supabase
        .from('event_logs')
        .update({ 
          status: 'completed', 
          processed_at: new Date().toISOString(),
          metadata: { ...event.metadata, handler_result: result }
        })
        .eq('id', event.id);

      console.log(`✅ Event Processed: ${event.event_type} (${event.id})`);

    } catch (err) {
      console.error(`❌ Error processing event ${event.id}:`, err.message);
      await supabase
        .from('event_logs')
        .update({ 
          status: 'failed', 
          error_message: err.message,
          processed_at: new Date().toISOString()
        })
        .eq('id', event.id);
    }
  }
}

module.exports = { processEvents };
