const { appEmitter } = require('../lib/events');
const { eventBus } = require('../core/queue/queue');
require('../core/events/handlers/crmSyncRequested'); // Register hardened handler

async function runTest() {
  const args = process.argv.slice(2);
  const tenantIdArg = args.find(a => a.startsWith('--tenant-id='));
  const leadIdArg = args.find(a => a.startsWith('--lead-id='));
  const forceArg = args.includes('--force');

  const tenant_id = tenantIdArg ? tenantIdArg.split('=')[1] : 'test-tenant-123';
  const lead_id = leadIdArg ? leadIdArg.split('=')[1] : 'lead-555';

  console.log(`[Test Phase 1.5] Triggering CRM Sync for Tenant: ${tenant_id}, Lead: ${lead_id}`);

  const lead_data = {
    first_name: 'Hardened',
    last_name: 'Test',
    email: `hardened-${lead_id}@example.com`,
    phone: '+15559998888',
    score: 95,
    grade: 'A+',
    urgency: 'critical',
    source: 'hardening-test',
    lifecycle: 'ready'
  };

  const payload = {
    tenant_id,
    entity_type: 'lead',
    entity_id: lead_id,
    event_type: 'crm.sync.requested',
    lead_data,
    provider: 'ghl'
  };

  // 1. First attempt
  console.log('\n--- Attempt 1 ---');
  await appEmitter.emit('crm.sync.requested', payload);

  // 2. Second attempt (should be blocked by idempotency)
  console.log('\n--- Attempt 2 (Duplicate) ---');
  await appEmitter.emit('crm.sync.requested', payload);

  // 3. Test with a new lead ID
  console.log('\n--- Attempt 3 (New Lead) ---');
  await appEmitter.emit('crm.sync.requested', {
    ...payload,
    entity_id: `lead-${Date.now()}`
  });
}

runTest().catch(console.error);
