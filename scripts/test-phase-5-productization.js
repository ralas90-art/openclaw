require('dotenv').config();

// Force the internal admin token for testing
const INTERNAL_ADMIN_TOKEN = process.env.INTERNAL_ADMIN_TOKEN || 'test-admin-token-123';
process.env.INTERNAL_ADMIN_TOKEN = INTERNAL_ADMIN_TOKEN;

const http = require('http');
// Need to spin up the server or assume it's running. For simplicity, let's start it inline or make HTTP calls if it's already running.
// We will test by fetching from the endpoints assuming the app is running, or we can just require app if it was exported.
// Since server.js calls app.listen, we'll spawn it as a child process.

const { spawn } = require('child_process');

async function runTests() {
  console.log("=== Phase 5 Productization End-to-End Test ===");
  
  const server = spawn('node', ['server.js'], { env: { ...process.env, PORT: 3001 }, stdio: 'inherit' });
  
  const baseUrl = 'http://localhost:3001';
  let serverUp = false;
  for (let i = 0; i < 10; i++) {
    try {
      await fetch(`${baseUrl}/`);
      serverUp = true;
      break;
    } catch (e) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  if (!serverUp) {
    console.error("Server failed to start");
    server.kill();
    return;
  }

  const headers = {
    'Authorization': `Bearer ${INTERNAL_ADMIN_TOKEN}`,
    'Content-Type': 'application/json'
  };

  try {
    console.log("\n1. Testing Unauthorized Access");
    const unauthorizedRes = await fetch(`${baseUrl}/api/admin/runtime/status`);
    if (unauthorizedRes.status === 401) {
      console.log("✅ Unauthorized guard works (401)");
    } else {
      console.log("❌ Unauthorized guard failed", unauthorizedRes.status);
    }

    console.log("\n2. Testing Runtime Status");
    const statusRes = await fetch(`${baseUrl}/api/admin/runtime/status`, { headers });
    const statusData = await statusRes.json();
    if (statusData.status) {
      console.log("✅ Runtime status:", statusData.status);
    } else {
      console.log("❌ Runtime status failed");
    }

    console.log("\n3. Testing Safe Mode Toggle");
    const safeRes = await fetch(`${baseUrl}/api/admin/runtime/safe-mode`, { 
      method: 'POST', 
      headers, 
      body: JSON.stringify({ action: 'enter', reason: 'Test Mode', confirm: true }) 
    });
    const safeData = await safeRes.json();
    if (safeData.success && safeData.safe_mode === true) {
      console.log("✅ Entered Safe Mode successfully");
    } else {
      console.log("❌ Failed to enter safe mode", safeData);
    }
    // revert
    await fetch(`${baseUrl}/api/admin/runtime/safe-mode`, { 
      method: 'POST', 
      headers, 
      body: JSON.stringify({ action: 'exit', confirm: true }) 
    });

    console.log("\n4. Testing Tenant Onboarding & Test Sync");
    const onboardRes = await fetch(`${baseUrl}/api/admin/tenants`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Test Tenant ' + Date.now(), provider: 'ghl', location_id: 'loc_123', access_token: 'sec_123' })
    });
    const onboardData = await onboardRes.json();
    if (onboardData.success && onboardData.tenant_id) {
      console.log("✅ Tenant onboarded:", onboardData.tenant_id);
      
      const testSyncRes = await fetch(`${baseUrl}/api/admin/tenants/${onboardData.tenant_id}/test-sync`, {
        method: 'POST',
        headers
      });
      const testSyncData = await testSyncRes.json();
      if (testSyncData.success) {
         console.log("✅ Test sync preflight result:", testSyncData.preflight.action);
      } else {
         console.log("❌ Test sync failed", testSyncData);
      }
    } else {
      console.log("❌ Tenant onboarding failed", onboardData);
    }

    console.log("\n5. Testing Executive Weekly Report");
    const reportRes = await fetch(`${baseUrl}/api/admin/reports/executive-weekly`, { headers });
    if (reportRes.ok) {
      const report = await reportRes.json();
      console.log("✅ Executive Report Generated:", report.status);
    } else {
      console.log("❌ Executive Report Failed", await reportRes.text());
    }

    console.log("\nAll tests completed.");
  } catch (err) {
    console.error("Test execution error:", err);
  } finally {
    server.kill();
  }
}

runTests();
