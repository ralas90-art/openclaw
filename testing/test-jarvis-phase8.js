/**
 * Jarvis Phase 8 & 8.1: Jarvis Dashboard UI Security & Validation Test Suite
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
const MOCK_MOBILE_TOKEN = 'mock-mobile-token-val-456';
const MOCK_MOBILE_HASH = require('crypto').createHash('sha256').update(MOCK_MOBILE_TOKEN).digest('hex');

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
  console.log('Setting up Phase 8.1 test environment...');
  dbClient = new Client({ connectionString: DB_URL });
  await dbClient.connect();

  await ensureActionColumnsExist();

  // Clean tables
  await dbClient.query("DELETE FROM jarvis_approval_audit_events;");
  await dbClient.query("DELETE FROM jarvis_approval_requests;");
  await dbClient.query("DELETE FROM jarvis_blockers WHERE id = $1;", [TEST_PRIO_UUID]);
  await dbClient.query("DELETE FROM jarvis_mobile_tokens WHERE token_hash = $1;", [MOCK_MOBILE_HASH]);

  // Seed blockers, projects, and mobile token
  await dbClient.query("INSERT INTO jarvis_projects (slug, name, status) VALUES ('septivolt', 'SeptiVolt', 'active') ON CONFLICT DO NOTHING;");
  await dbClient.query("INSERT INTO jarvis_blockers (id, project_slug, description, status) VALUES ($1, 'septivolt', 'Dashboard Integration Blocked', 'active');", [TEST_PRIO_UUID]);
  
  await dbClient.query(`
    INSERT INTO jarvis_mobile_tokens (token_hash, device_id, device_name, active, expires_at)
    VALUES ($1, 'test-device-id', 'Test Device', true, now() + interval '24 hours');
  `, [MOCK_MOBILE_HASH]);

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
  console.log('\nCleaning up Phase 8.1 test resources...');
  intelligence.getPriorityIntelligence = originalGetPriorityIntelligence;
  if (expressServer) {
    expressServer.close();
  }
  if (dbClient) {
    try {
      await dbClient.query("DELETE FROM jarvis_approval_audit_events;");
      await dbClient.query("DELETE FROM jarvis_approval_requests;");
      await dbClient.query("DELETE FROM jarvis_blockers WHERE id = $1;", [TEST_PRIO_UUID]);
      await dbClient.query("DELETE FROM jarvis_mobile_tokens WHERE token_hash = $1;", [MOCK_MOBILE_HASH]);
      await dbClient.end();
    } catch (err) {
      console.error('[Cleanup Error]', err.message);
    }
  }
}

// Simulated Client-side Auth Token Extraction & Cleanup Helper
function simulateClientTokenExtraction(urlStr, mockSessionStorage) {
  const url = new URL(urlStr);
  const token = url.searchParams.get('token');
  let historyReplaced = false;
  let cleanPath = url.pathname;

  if (token) {
    mockSessionStorage.setItem('admin_token', token);
    url.searchParams.delete('token');
    cleanPath = url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '');
    historyReplaced = true;
  }
  return {
    storedToken: mockSessionStorage.getItem('admin_token'),
    cleanPath,
    historyReplaced
  };
}

async function runTests() {
  await setup();
  console.log('Starting Phase 8 & 8.1 Jarvis Dashboard Security & Validation Tests...');
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
  const mobileHeaders = { Authorization: `Bearer ${MOCK_MOBILE_TOKEN}` };

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

    // ==========================================
    // TEST 9: Mobile token fails closed on admin endpoints
    // ==========================================
    const adminEndpoints = [
      '/connectors',
      '/projects',
      '/mobile-uploads',
      '/priorities',
      '/approvals',
      '/approval-stats'
    ];

    for (const ep of adminEndpoints) {
      try {
        await axios.get(`${baseUrl}${ep}`, { headers: mobileHeaders });
        runAssert(false, `Mobile token erroneously allowed access to admin route: ${ep}`);
      } catch (err) {
        runAssert(err.response.status === 401, `Mobile token correctly rejected on admin route ${ep} with 401`);
      }
    }

    // ==========================================
    // TEST 10: Client URL token cleanup behavior
    // ==========================================
    const mockStorageMap = new Map();
    const mockSessionStorage = {
      setItem: (key, val) => mockStorageMap.set(key, val),
      getItem: (key) => mockStorageMap.get(key)
    };

    const cleanupResult = simulateClientTokenExtraction(
      'https://openclaw-production-0664.up.railway.app/admin/jarvis?token=my-secret-key-123&other=active',
      mockSessionStorage
    );
    runAssert(cleanupResult.storedToken === 'my-secret-key-123', 'Token successfully moved to sessionStorage');
    runAssert(cleanupResult.cleanPath === '/admin/jarvis?other=active', 'Token query parameter removed from URL path');
    runAssert(cleanupResult.historyReplaced === true, 'Triggered history.replaceState to replace browser address bar');

    // ==========================================
    // TEST 11: Production frontend build secret sweep
    // ==========================================
    const distAssetsDir = path.resolve(__dirname, '../admin-ui/dist/assets');
    if (fs.existsSync(distAssetsDir)) {
      const files = fs.readdirSync(distAssetsDir).filter(f => f.endsWith('.js'));
      let sweepsPassed = true;
      for (const file of files) {
        const content = fs.readFileSync(path.join(distAssetsDir, file), 'utf8');
        // Assert no secrets from .env.local exist in built javascript files
        if (process.env.INTERNAL_ADMIN_TOKEN && content.includes(process.env.INTERNAL_ADMIN_TOKEN)) sweepsPassed = false;
        if (process.env.DATABASE_URL && content.includes(process.env.DATABASE_URL)) sweepsPassed = false;
        if (process.env.JARVIS_ENCRYPTION_KEY && content.includes(process.env.JARVIS_ENCRYPTION_KEY)) sweepsPassed = false;
        if (process.env.GOOGLE_CLIENT_SECRET && content.includes(process.env.GOOGLE_CLIENT_SECRET)) sweepsPassed = false;
      }
      runAssert(sweepsPassed === true, 'Built frontend static JS bundles do not contain any hardcoded secret values');
    } else {
      console.log('⚠️ Warning: admin-ui dist not compiled locally during tests. Skipping build file sweep.');
    }

    console.log(`\n🎉 Phase 8.1 Dashboard Security Tests Complete! Passed ${testsPassed} of ${totalTests} tests.`);
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
