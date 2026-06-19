/**
 * Jarvis Phase 8: Jarvis Dashboard UI Integration Test Suite
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
process.env.NODE_ENV = 'test';
process.env.INTERNAL_ADMIN_TOKEN = 'test-token-dashboard-8';

const { ensureActionColumnsExist } = require('../jarvis/actions');
const { queryDb } = require('../jarvis/controller');
const intelligence = require('../jarvis/intelligence');

const DB_URL = process.env.DATABASE_URL;
let dbClient;
let expressServer;
let baseUrl;

const TEST_PRIO_UUID = '88888888-8888-8888-8888-888888888888';

// Stub getPriorityIntelligence
const originalGetPriorityIntelligence = intelligence.getPriorityIntelligence;
intelligence.getPriorityIntelligence = async function() {
  return {
    pinnedIds: [],
    rankedItems: [
      {
        priority_id: 'blocker:' + TEST_PRIO_UUID,
        type: 'blocker',
        heading: 'Resolve Dashboard Test Blocker',
        score: 50,
        project_slug: 'septivolt',
        reasons: [],
        raw: { id: TEST_PRIO_UUID, description: 'Dashboard Integration Blocked' }
      }
    ]
  };
};

async function setup() {
  console.log('Setting up Phase 8 test environment...');
  dbClient = new Client({ connectionString: DB_URL });
  await dbClient.connect();

  await ensureActionColumnsExist();

  // Clean tables
  await dbClient.query("DELETE FROM jarvis_approval_audit_events;");
  await dbClient.query("DELETE FROM jarvis_approval_requests;");
  await dbClient.query("DELETE FROM jarvis_blockers WHERE id = $1;", [TEST_PRIO_UUID]);

  // Seed blockers and projects
  await dbClient.query("INSERT INTO jarvis_projects (slug, name, status) VALUES ('septivolt', 'SeptiVolt', 'active') ON CONFLICT DO NOTHING;");
  await dbClient.query("INSERT INTO jarvis_blockers (id, project_slug, description, status) VALUES ($1, 'septivolt', 'Dashboard Integration Blocked', 'active');", [TEST_PRIO_UUID]);

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
  console.log('\nCleaning up Phase 8 test resources...');
  intelligence.getPriorityIntelligence = originalGetPriorityIntelligence;
  if (expressServer) {
    expressServer.close();
  }
  if (dbClient) {
    try {
      await dbClient.query("DELETE FROM jarvis_approval_audit_events;");
      await dbClient.query("DELETE FROM jarvis_approval_requests;");
      await dbClient.query("DELETE FROM jarvis_blockers WHERE id = $1;", [TEST_PRIO_UUID]);
      await dbClient.end();
    } catch (err) {
      console.error('[Cleanup Error]', err.message);
    }
  }
}

async function runTests() {
  await setup();
  console.log('Starting Phase 8 Jarvis Dashboard UI Integration Tests...');
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

  const headers = { Authorization: `Bearer ${process.env.INTERNAL_ADMIN_TOKEN}` };

  try {
    // ==========================================
    // TEST 1: Gated routes reject unauthorized access
    // ==========================================
    const endpoints = [
      '/connectors',
      '/projects',
      '/mobile-uploads',
      '/priorities',
      '/daily-brief'
    ];

    for (const ep of endpoints) {
      try {
        await axios.get(`${baseUrl}${ep}`);
        runAssert(false, `Gated route ${ep} allowed access without token (Failed)`);
      } catch (err) {
        runAssert(err.response.status === 401, `Gated route ${ep} rejected missing token with 401`);
      }
    }

    // ==========================================
    // TEST 2: Daily Brief accepts admin token
    // ==========================================
    const briefRes = await axios.get(`${baseUrl}/daily-brief`, { headers });
    runAssert(briefRes.status === 200, 'GET /daily-brief succeeds with admin token');
    runAssert(briefRes.data.success === true, 'GET /daily-brief returns successful json structure');

    // ==========================================
    // TEST 3: Priorities API retrieves items
    // ==========================================
    const prioritiesRes = await axios.get(`${baseUrl}/priorities`, { headers });
    runAssert(prioritiesRes.status === 200, 'GET /priorities succeeds with admin token');
    runAssert(prioritiesRes.data.rankedItems.length > 0, 'GET /priorities returns intelligence items');

    // ==========================================
    // TEST 4: Connectors API retrieves statuses
    // ==========================================
    const connectorsRes = await axios.get(`${baseUrl}/connectors`, { headers });
    runAssert(connectorsRes.status === 200, 'GET /connectors succeeds with admin token');
    runAssert(Array.isArray(connectorsRes.data), 'GET /connectors returns list of connectors');

    // ==========================================
    // TEST 5: Projects API retrieves list
    // ==========================================
    const projectsRes = await axios.get(`${baseUrl}/projects`, { headers });
    runAssert(projectsRes.status === 200, 'GET /projects retrieves project statuses');
    runAssert(projectsRes.data.some(p => p.slug === 'septivolt'), 'GET /projects includes seeded septivolt project');

    // ==========================================
    // TEST 6: Mobile Uploads API retrieves list
    // ==========================================
    const mobileRes = await axios.get(`${baseUrl}/mobile-uploads`, { headers });
    runAssert(mobileRes.status === 200, 'GET /mobile-uploads retrieves uploads list');

    // ==========================================
    // TEST 7: Actions mutations (propose, approve, reject, cancel)
    // ==========================================
    const proposeRes = await axios.post(`${baseUrl}/priorities/blocker:${TEST_PRIO_UUID}/propose`, {}, { headers });
    runAssert(proposeRes.status === 200, 'POST /priorities/:id/propose succeeds');
    const propId = proposeRes.data.proposal.id;
    runAssert(propId !== undefined, 'Proposal returns ID');

    // Verify stats counts pending
    const statsRes1 = await axios.get(`${baseUrl}/approval-stats`, { headers });
    runAssert(statsRes1.data.status_counts.pending === 1, 'Stats aggregates pending correctly');

    // Reject proposal
    const rejectRes = await axios.post(`${baseUrl}/approvals/${propId}/reject`, {}, { headers });
    runAssert(rejectRes.status === 200, 'POST /approvals/:id/reject succeeds');

    const statsRes2 = await axios.get(`${baseUrl}/approval-stats`, { headers });
    runAssert(statsRes2.data.status_counts.rejected === 1, 'Stats aggregates rejected correctly');

    // Propose again and Approve/Execute
    const proposeRes2 = await axios.post(`${baseUrl}/priorities/blocker:${TEST_PRIO_UUID}/propose`, {}, { headers });
    const propId2 = proposeRes2.data.proposal.id;

    const approveRes = await axios.post(`${baseUrl}/approvals/${propId2}/approve`, {}, { headers });
    runAssert(approveRes.status === 200, 'POST /approvals/:id/approve succeeds');
    runAssert(approveRes.data.result.includes('✅ Blocker Resolved'), 'Approve returns success message');

    const statsRes3 = await axios.get(`${baseUrl}/approval-stats`, { headers });
    runAssert(statsRes3.data.status_counts.executed === 1, 'Stats aggregates executed correctly');

    // ==========================================
    // TEST 8: Response payloads do not leak secrets
    // ==========================================
    const fullLogString = JSON.stringify(prioritiesRes.data) + JSON.stringify(connectorsRes.data) + JSON.stringify(briefRes.data);
    runAssert(!fullLogString.includes('test-token-dashboard-8'), 'API output does not leak INTERNAL_ADMIN_TOKEN');
    runAssert(!fullLogString.includes('postgres://'), 'API output does not leak database credentials');

    console.log(`\n🎉 Phase 8 Dashboard Integration Tests Complete! Passed ${testsPassed} of ${totalTests} tests.`);
  } catch (err) {
    console.error('Fatal integration test error:', err.message);
    if (err.response) {
      console.error('Response status:', err.response.status);
      console.error('Response data:', err.response.data);
    }
    process.exit(1);
  }
}

runTests().then(cleanup).catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
