/**
 * Jarvis Phase 7.1: Approval Audit Dashboard + Action History Test Suite
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const dotenv = require('dotenv');
const { Client } = require('pg');
const express = require('express');
const axios = require('axios');

// Load environment variables
const envLocalPath = path.resolve(__dirname, '../.env.local');
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
} else if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

process.env.TELEGRAM_ALLOWED_RUNTIME_CHAT_IDS = '12345';
process.env.TELEGRAM_ALLOWED_USER_IDS = '12345';
process.env.OPENCLAW_ROLE_SUPER_ADMIN_CHAT_IDS = '12345';
process.env.NODE_ENV = 'test';
process.env.INTERNAL_ADMIN_TOKEN = 'test-token-123';

const {
  proposeAction,
  approveRequest,
  rejectApproval,
  cancelApproval,
  cleanupExpiredApprovals,
  executeApprovedAction,
  ensureActionColumnsExist
} = require('../jarvis/actions');
const { queryDb } = require('../jarvis/controller');
const { handleCommand } = require('../interfaces/telegram/handlers');
const intelligence = require('../jarvis/intelligence');

const DB_URL = process.env.DATABASE_URL;
let dbClient;
let expressServer;
let baseUrl;

const TEST_BLOCKER_UUID = '77777777-7777-7777-7777-777777777777';

// Stub getPriorityIntelligence
const originalGetPriorityIntelligence = intelligence.getPriorityIntelligence;
intelligence.getPriorityIntelligence = async function() {
  return {
    pinnedIds: [],
    rankedItems: [
      {
        priority_id: 'blocker:' + TEST_BLOCKER_UUID,
        type: 'blocker',
        heading: 'Resolve Test Blocker',
        score: 50,
        project_slug: 'septivolt',
        reasons: [],
        raw: { id: TEST_BLOCKER_UUID, description: 'API Integration Blocked' }
      }
    ]
  };
};

async function setup() {
  console.log('Setting up Phase 7.1 test environment...');
  dbClient = new Client({ connectionString: DB_URL });
  await dbClient.connect();

  // Ensure table updates
  await ensureActionColumnsExist();

  // Clean tables
  await dbClient.query("DELETE FROM jarvis_approval_audit_events;");
  await dbClient.query("DELETE FROM jarvis_approval_requests;");
  await dbClient.query("DELETE FROM jarvis_blockers WHERE id = $1;", [TEST_BLOCKER_UUID]);

  // Seed blockers
  await dbClient.query("INSERT INTO jarvis_projects (slug, name, status) VALUES ('septivolt', 'SeptiVolt', 'active') ON CONFLICT DO NOTHING;");
  await dbClient.query("INSERT INTO jarvis_blockers (id, project_slug, description, status) VALUES ($1, 'septivolt', 'API Integration Blocked', 'active');", [TEST_BLOCKER_UUID]);

  // Start ephemeral Express server for routes testing
  const router = require('../jarvis/routes');
  const app = express();
  app.use(express.json());
  app.use('/api/jarvis', router);
  
  return new Promise((resolve) => {
    expressServer = app.listen(0, () => {
      const port = expressServer.address().port;
      baseUrl = `http://localhost:${port}/api/jarvis`;
      console.log(`Test Express server running at: ${baseUrl}`);
      resolve();
    });
  });
}

async function cleanup() {
  console.log('\nCleaning up Phase 7.1 test resources...');
  intelligence.getPriorityIntelligence = originalGetPriorityIntelligence;
  if (expressServer) {
    expressServer.close();
  }
  if (dbClient) {
    try {
      await dbClient.query("DELETE FROM jarvis_approval_audit_events;");
      await dbClient.query("DELETE FROM jarvis_approval_requests;");
      await dbClient.query("DELETE FROM jarvis_blockers WHERE id = $1;", [TEST_BLOCKER_UUID]);
      await dbClient.end();
    } catch (err) {
      console.error('[Cleanup Error]', err.message);
    }
  }
}

async function runTests() {
  await setup();
  console.log('Starting Phase 7.1 Approval Audit + History Integration Tests...');
  let testsPassed = 0;
  let totalTests = 0;

  function runAssert(condition, message) {
    totalTests++;
    if (condition) {
      testsPassed++;
      console.log(`✅ Test ${totalTests} Passed: ${message}`);
    } else {
      console.error(`❌ Test ${totalTests} Failed: ${message}`);
      throw new Error(`Test failure: ${message}`);
    }
  }

  const mockMessage = {
    chat: { id: 12345 },
    from: { id: 12345 }
  };

  try {
    // ==========================================
    // TEST 1: Proposal inserts write audit logs
    // ==========================================
    const prop = await proposeAction('blocker:' + TEST_BLOCKER_UUID, '12345');
    runAssert(prop.id !== undefined, 'Proposal successfully created');
    runAssert(prop.requested_by === '12345', 'Tracks proposed requester chat ID');
    runAssert(prop.source_priority_id === 'blocker:' + TEST_BLOCKER_UUID, 'Tracks source priority ID');

    const audit1 = await queryDb("SELECT * FROM jarvis_approval_audit_events WHERE approval_id = $1;", [prop.id]);
    runAssert(audit1.length === 1, 'Audit log created for initial proposal');
    runAssert(audit1[0].event_type === 'propose', 'Audit event type matches propose');
    runAssert(audit1[0].new_status === 'pending', 'Audit transition new_status is pending');
    runAssert(audit1[0].actor === '12345', 'Audit tracks the actor ID');

    // ==========================================
    // TEST 2: Approve command updates DB + writes audit logs
    // ==========================================
    const approveResultText = await handleCommand(`/jarvis_approve ${prop.id}`, mockMessage);
    runAssert(approveResultText.includes('✅ Blocker Resolved'), 'Approve executes the action successfully');

    const propRow1 = await queryDb("SELECT * FROM jarvis_approval_requests WHERE id = $1;", [prop.id]);
    runAssert(propRow1[0].status === 'executed', 'Status transitions to executed');
    runAssert(propRow1[0].approved_by === '12345', 'Tracks approver');
    runAssert(propRow1[0].executed_by === '12345', 'Tracks executor');
    runAssert(propRow1[0].approved_at !== null, 'Records approved_at timestamp');
    runAssert(propRow1[0].executed_at !== null, 'Records executed_at timestamp');
    runAssert(propRow1[0].action_result_summary !== null, 'Records action_result_summary');

    const auditEvents = await queryDb("SELECT * FROM jarvis_approval_audit_events WHERE approval_id = $1 ORDER BY created_at ASC;", [prop.id]);
    runAssert(auditEvents.length === 3, 'Created exactly 3 audit events (propose -> approve -> execute)');
    runAssert(auditEvents[1].event_type === 'approve', 'Second event is approve');
    runAssert(auditEvents[2].event_type === 'execute', 'Third event is execute');

    // ==========================================
    // TEST 3: Reject writes rejection timestamp & audit logs
    // ==========================================
    const prop2 = await proposeAction('blocker:' + TEST_BLOCKER_UUID, '12345');
    await handleCommand(`/jarvis_reject ${prop2.id}`, mockMessage);

    const propRow2 = await queryDb("SELECT * FROM jarvis_approval_requests WHERE id = $1;", [prop2.id]);
    runAssert(propRow2[0].status === 'rejected', 'Status changed to rejected');
    runAssert(propRow2[0].rejected_at !== null, 'Records rejected_at timestamp');

    const auditEvents2 = await queryDb("SELECT * FROM jarvis_approval_audit_events WHERE approval_id = $1 ORDER BY created_at ASC;", [prop2.id]);
    runAssert(auditEvents2.length === 2, 'Rejection creates reject audit event');
    runAssert(auditEvents2[1].event_type === 'reject', 'Rejection event type is correct');

    // ==========================================
    // TEST 4: Cancel writes cancellation timestamp & audit logs
    // ==========================================
    const prop3 = await proposeAction('blocker:' + TEST_BLOCKER_UUID, '12345');
    await handleCommand(`/jarvis_cancel_approval ${prop3.id}`, mockMessage);

    const propRow3 = await queryDb("SELECT * FROM jarvis_approval_requests WHERE id = $1;", [prop3.id]);
    runAssert(propRow3[0].status === 'cancelled', 'Status changed to cancelled');
    runAssert(propRow3[0].cancelled_at !== null, 'Records cancelled_at timestamp');

    const auditEvents3 = await queryDb("SELECT * FROM jarvis_approval_audit_events WHERE approval_id = $1 ORDER BY created_at ASC;", [prop3.id]);
    runAssert(auditEvents3.length === 2, 'Cancellation creates cancel audit event');
    runAssert(auditEvents3[1].event_type === 'cancel', 'Cancellation event type matches');

    // ==========================================
    // TEST 5: Expiration transitions status & logs audit
    // ==========================================
    // Seed an already expired pending request
    const expPropRows = await queryDb(`
      INSERT INTO jarvis_approval_requests (
        approval_type, action_type, project_slug, priority_id, status, requested_action, expires_at
      ) VALUES ('proposal', 'resolve_blocker', 'septivolt', 'blocker:expired', 'pending', 'Expired test action', now() - interval '1 hour') RETURNING id;
    `);
    const expPropId = expPropRows[0].id;

    await cleanupExpiredApprovals();
    const expCheck = await queryDb("SELECT status, expired_at FROM jarvis_approval_requests WHERE id = $1;", [expPropId]);
    runAssert(expCheck[0].status === 'expired', 'Expired request automatically marked as expired');
    runAssert(expCheck[0].expired_at !== null, 'Expired timestamp populated');

    const expAudit = await queryDb("SELECT * FROM jarvis_approval_audit_events WHERE approval_id = $1;", [expPropId]);
    runAssert(expAudit.length === 1 && expAudit[0].event_type === 'expire', 'Expired event logged in audit logs');

    // ==========================================
    // TEST 6: Telegram History & Stats Command
    // ==========================================
    const historyText = await handleCommand('/jarvis_approval_history', mockMessage);
    runAssert(historyText.includes('📥 *Jarvis Approval History*'), 'History command outputs title');
    runAssert(historyText.includes(prop.id), 'History lists executed proposal');

    const statsText = await handleCommand('/jarvis_approval_stats', mockMessage);
    runAssert(statsText.includes('📊 *Jarvis Approval Statistics*'), 'Stats command outputs title');
    runAssert(statsText.includes('Executed:*'), 'Stats command displays executed stats count');

    // ==========================================
    // TEST 7: Dashboard HTTP API Authentication Guards
    // ==========================================
    try {
      await axios.get(`${baseUrl}/approvals`);
      runAssert(false, 'Dashboard route allows access without token (Failed)');
    } catch (err) {
      runAssert(err.response.status === 401, 'Endpoint returns 401 when token is missing');
    }

    try {
      await axios.get(`${baseUrl}/approvals`, {
        headers: { Authorization: 'Bearer bad-token' }
      });
      runAssert(false, 'Dashboard route allows access with bad token (Failed)');
    } catch (err) {
      runAssert(err.response.status === 401, 'Endpoint returns 401 on incorrect token');
    }

    // Access with correct session token
    const { createSessionToken } = require('../jarvis/auth-tickets');
    const adminSessionToken = await createSessionToken({ user: 'test_admin' }, 3600);
    const headers = { Authorization: `Bearer ${adminSessionToken}` };
    const resList = await axios.get(`${baseUrl}/approvals`, { headers });
    runAssert(resList.status === 200, 'Listing endpoint returns 200 on authorized header');
    runAssert(Array.isArray(resList.data), 'Returns JSON array of approvals');

    const resDetails = await axios.get(`${baseUrl}/approvals/${prop.id}`, { headers });
    runAssert(resDetails.status === 200, 'Detail endpoint returns 200 on valid UUID');
    runAssert(resDetails.data.id === prop.id, 'Returns correct details record');
    runAssert(Array.isArray(resDetails.data.audit_events), 'Includes associated audit events list');

    const resStats = await axios.get(`${baseUrl}/approval-stats`, { headers });
    runAssert(resStats.status === 200, 'Stats endpoint returns 200');
    runAssert(resStats.data.status_counts.executed >= 1, 'Stats aggregates executed counts accurately');

    // ==========================================
    // TEST 8: API Payload Truncation Guard
    // ==========================================
    const largePayload = { test_data: 'a'.repeat(600) };
    const largePropRows = await queryDb(`
      INSERT INTO jarvis_approval_requests (
        approval_type, action_type, project_slug, priority_id, status, requested_action, proposed_payload
      ) VALUES ('proposal', 'resolve_blocker', 'septivolt', 'blocker:large', 'pending', 'Large test action', $1) RETURNING id;
    `, [JSON.stringify(largePayload)]);
    const largeId = largePropRows[0].id;

    const largeRes = await axios.get(`${baseUrl}/approvals/${largeId}`, { headers });
    const payloadPreview = largeRes.data.proposed_payload;
    runAssert(payloadPreview._info === '[truncated for display]', 'Large payloads are truncated in API details responses');

    // ==========================================
    // TEST 9: Error logs and output sanitization
    // ==========================================
    // Check that no secrets (e.g. token, keys, database urls) are visible in output or logs
    const historyLeakCheck = JSON.stringify(resList.data);
    runAssert(!historyLeakCheck.includes('test-token-123'), 'Outputs do not leak INTERNAL_ADMIN_TOKEN');
    runAssert(!historyLeakCheck.includes('postgres://'), 'Outputs do not leak database urls');

    console.log(`\n🎉 Phase 7.1 Integration Tests Complete! Passed ${testsPassed} of ${totalTests} tests.`);
  } catch (err) {
    console.error('Fatal integration test error:', err.message);
    process.exit(1);
  }
}

runTests().then(cleanup).catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
