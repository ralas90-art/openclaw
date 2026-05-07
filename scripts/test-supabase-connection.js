const { listTenants } = require('../core/memory');
const { emitEvent } = require('../core/events');

async function runTest() {
  console.log('🧪 Starting Supabase Connection Test...');

  try {
    // 1. List Tenants
    console.log('📂 Fetching tenants...');
    const tenants = await listTenants();
    
    if (tenants.length === 0) {
      console.warn('⚠️ No tenants found in database. Please add a tenant to the "tenants" table first.');
      return;
    }

    const firstTenant = tenants[0];
    console.log(`✅ Connection Successful! Found tenant: ${firstTenant.name} (${firstTenant.id})`);

    // 2. Create Test Event
    console.log('📡 Emitting test event...');
    const event = await emitEvent(
      firstTenant.id, 
      'system.test_connection', 
      'test', 
      null, 
      { message: 'Supabase integration is working!' }
    );

    if (event) {
      console.log('✅ Test event successfully persisted to "event_logs" table.');
    } else {
      console.error('❌ Failed to persist test event.');
    }

  } catch (err) {
    console.error('❌ Test Failed:', err.message);
  }
}

runTest();
