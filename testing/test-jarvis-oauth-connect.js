const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

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

// Set up mock admin token and encryption key if not configured
if (!process.env.INTERNAL_ADMIN_TOKEN) {
  process.env.INTERNAL_ADMIN_TOKEN = 'test-admin-token-xyz-123';
}
if (!process.env.JARVIS_ENCRYPTION_KEY) {
  process.env.JARVIS_ENCRYPTION_KEY = 'test-encryption-key-xyz-123-abc-456';
}
if (!process.env.GOOGLE_CLIENT_ID) {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
}
if (!process.env.GOOGLE_CLIENT_SECRET) {
  process.env.GOOGLE_CLIENT_SECRET = 'GOCSPX-test-client-secret';
}

const assert = require('assert');
const { Client } = require('pg');
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const DB_URL = process.env.DATABASE_URL;
const PORT = 3999;
let client;
let server;
let dbBackup = [];

async function setup() {
  console.log('Setting up Jarvis OAuth Connect validation...');
  if (!DB_URL) {
    console.error('Error: DATABASE_URL is not set.');
    process.exit(1);
  }

  client = new Client({ connectionString: DB_URL });
  await client.connect();

  // 1. Back up any existing connector tokens
  const backupRes = await client.query(
    `SELECT * FROM jarvis_connector_tokens WHERE connector_id IN ('gmail', 'google_drive');`
  );
  dbBackup = backupRes.rows;
  console.log(`[Backup] Backed up ${dbBackup.length} connector token records.`);

  // 2. Clear rows for clean test run
  await client.query("DELETE FROM jarvis_connector_tokens WHERE connector_id IN ('gmail', 'google_drive');");

  // 3. Ensure connectors definitions exist
  await client.query(`
    INSERT INTO jarvis_connectors (connector_id, name, enabled, read_permissions, write_permissions, write_gated)
    VALUES 
      ('gmail', 'Gmail Connector', true, '["https://www.googleapis.com/auth/gmail.readonly"]'::jsonb, '[]'::jsonb, true),
      ('google_drive', 'Google Drive Connector', true, '["https://www.googleapis.com/auth/drive.metadata.readonly"]'::jsonb, '[]'::jsonb, true)
    ON CONFLICT (connector_id) DO NOTHING;
  `);

  // 4. Start mock local express server mounting jarvis router
  const jarvisRouter = require('../jarvis/routes');
  const app = express();
  app.use(express.json());
  app.use('/api/jarvis', jarvisRouter);

  server = app.listen(PORT, () => {
    console.log(`[Setup] Test Express server listening on port ${PORT}`);
  });
}

async function cleanup() {
  console.log('\nCleaning up Jarvis OAuth Connect validation...');
  
  if (server) {
    server.close();
    console.log('[Cleanup] Test server stopped.');
  }

  if (client) {
    try {
      // Clear test records
      await client.query("DELETE FROM jarvis_connector_tokens WHERE connector_id IN ('gmail', 'google_drive');");

      // Restore backup
      for (const row of dbBackup) {
        await client.query(`
          INSERT INTO jarvis_connector_tokens (
            id, connector_id, access_token, refresh_token, token_type, 
            expires_at, client_id, client_secret, updated_at, 
            last_used_at, last_sync_status, rotation_status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (connector_id) DO NOTHING;
        `, [
          row.id, row.connector_id, row.access_token, row.refresh_token, row.token_type,
          row.expires_at, row.client_id, row.client_secret, row.updated_at,
          row.last_used_at, row.last_sync_status, row.rotation_status
        ]);
      }
      console.log(`[Cleanup] Restored ${dbBackup.length} connector token records.`);
      await client.end();
    } catch (err) {
      console.error('[Cleanup DB Error]', err.message);
    }
  }
}

async function runTests() {
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

  const adminToken = process.env.INTERNAL_ADMIN_TOKEN;

  // ==========================================
  // TEST 1: Connect Route Authorization
  // ==========================================
  try {
    await axios.get(`http://localhost:${PORT}/api/jarvis/google/connect?connector=gmail`);
    runAssert(false, 'Connect route should reject requests without token');
  } catch (err) {
    runAssert(err.response.status === 401, 'Connect route returns 401 for missing token');
  }

  try {
    await axios.get(`http://localhost:${PORT}/api/jarvis/google/connect?connector=gmail&token=invalid-token`);
    runAssert(false, 'Connect route should reject requests with invalid token');
  } catch (err) {
    runAssert(err.response.status === 401, 'Connect route returns 401 for invalid token');
  }

  // ==========================================
  // TEST 2: Connector ID Validation
  // ==========================================
  try {
    await axios.get(`http://localhost:${PORT}/api/jarvis/google/connect?connector=invalid_id&token=${adminToken}`);
    runAssert(false, 'Connect route should reject invalid connector IDs');
  } catch (err) {
    runAssert(err.response.status === 400, 'Connect route returns 400 for invalid connector ID');
  }

  // ==========================================
  // TEST 3: State Nonce Generation
  // ==========================================
  const connectRes = await axios.get(
    `http://localhost:${PORT}/api/jarvis/google/connect?connector=gmail&token=${adminToken}`,
    { maxRedirects: 0, validateStatus: () => true }
  );
  
  runAssert(connectRes.status === 302, 'Connect route returns 302 redirect');
  const redirectUrl = connectRes.headers.location;
  runAssert(redirectUrl.includes('accounts.google.com'), 'Redirects to accounts.google.com');
  
  const urlParams = new URLSearchParams(redirectUrl.split('?')[1]);
  const state = urlParams.get('state');
  runAssert(!!state, 'Redirect URL includes a state parameter');

  const stateParts = state.split(':');
  runAssert(stateParts.length === 3, 'State parameter contains exactly 3 parts');
  runAssert(stateParts[0] === 'gmail', 'State parameter correctly specifies the connector ID');
  runAssert(parseInt(stateParts[1], 10) > Date.now(), 'State parameter specifies a future expiration time');

  // Verify HMAC signature validation works
  const hmac = crypto.createHmac('sha256', process.env.JARVIS_ENCRYPTION_KEY);
  hmac.update(`${stateParts[0]}:${stateParts[1]}`);
  const expectedSig = hmac.digest('hex');
  runAssert(stateParts[2] === expectedSig, 'State parameter signature matches expectations');

  // ==========================================
  // TEST 4: Callback State Validations (Invalid / Expired / Mismatched)
  // ==========================================
  // 1. Missing code/state
  const cbRes1 = await axios.get(`http://localhost:${PORT}/api/jarvis/google/callback`, { validateStatus: () => true });
  runAssert(cbRes1.status === 400, 'Callback returns 400 for missing code and state');

  // 2. Expired state
  const expiredExpiry = Date.now() - 1000;
  const hmacExpired = crypto.createHmac('sha256', process.env.JARVIS_ENCRYPTION_KEY);
  hmacExpired.update(`gmail:${expiredExpiry}`);
  const expiredSig = hmacExpired.digest('hex');
  const expiredState = `gmail:${expiredExpiry}:${expiredSig}`;

  const cbRes2 = await axios.get(
    `http://localhost:${PORT}/api/jarvis/google/callback?code=mock_code&state=${expiredState}`,
    { validateStatus: () => true }
  );
  runAssert(cbRes2.status === 400 && cbRes2.data.includes('expired'), 'Callback returns 400 for expired state session');

  // 3. Invalid Signature
  const invalidState = `gmail:${stateParts[1]}:invalid_signature_hex`;
  const cbRes3 = await axios.get(
    `http://localhost:${PORT}/api/jarvis/google/callback?code=mock_code&state=${invalidState}`,
    { validateStatus: () => true }
  );
  runAssert(cbRes3.status === 400 && cbRes3.data.includes('signature'), 'Callback returns 400 for invalid signature state');

  // ==========================================
  // TEST 5: Callback Successful Reconnect & GCM Seeding
  // ==========================================
  // Mock Googleauth exchange logic by replacing Googleapis package call or mocking OAuth2 client
  // But wait, the route has require('googleapis'). If we mock it globally or mock the client prototype, we can bypass network calls.
  const { google } = require('googleapis');
  const originalGetToken = google.auth.OAuth2.prototype.getToken;
  
  // Set up mock token exchange
  google.auth.OAuth2.prototype.getToken = async function(code) {
    runAssert(code === 'valid_mock_code', 'OAuth client received the correct auth code');
    return {
      tokens: {
        access_token: 'mock-access-token-999',
        refresh_token: 'mock-refresh-token-888',
        expiry_date: Date.now() + 3600 * 1000
      }
    };
  };

  try {
    const successExpiry = Date.now() + 5 * 60 * 1000;
    const hmacSuccess = crypto.createHmac('sha256', process.env.JARVIS_ENCRYPTION_KEY);
    hmacSuccess.update(`gmail:${successExpiry}`);
    const successSig = hmacSuccess.digest('hex');
    const successState = `gmail:${successExpiry}:${successSig}`;

    const cbRes4 = await axios.get(
      `http://localhost:${PORT}/api/jarvis/google/callback?code=valid_mock_code&state=${successState}`
    );

    runAssert(cbRes4.status === 200, 'Callback returns 200 Success status');
    runAssert(cbRes4.data.includes('connected successfully'), 'Callback response HTML matches success message');

    // Verify row was written to database
    const dbRes = await client.query(
      `SELECT client_id, client_secret, refresh_token, rotation_status, last_sync_status 
       FROM jarvis_connector_tokens 
       WHERE connector_id = 'gmail';`
    );
    
    runAssert(dbRes.rows.length === 1, 'Callback upserted a single record in database');
    const dbRow = dbRes.rows[0];
    
    runAssert(dbRow.client_id === process.env.GOOGLE_CLIENT_ID, 'Client ID saved matches environmental variable');
    runAssert(dbRow.rotation_status === 'active', 'Rotation status is set back to active');
    runAssert(dbRow.last_sync_status === 'connected', 'Last sync status is set to connected');

    // Verify cryptographic GCM formatting
    const { decrypt } = require('../jarvis/google-api');
    
    const secretParts = dbRow.client_secret.split(':');
    runAssert(secretParts.length === 3, 'Client secret is stored in GCM format (3 parts)');
    
    const decryptedSecret = decrypt(dbRow.client_secret);
    runAssert(decryptedSecret === process.env.GOOGLE_CLIENT_SECRET, 'Decrypted GCM client secret matches original');

    const tokenParts = dbRow.refresh_token.split(':');
    runAssert(tokenParts.length === 3, 'Refresh token is stored in GCM format (3 parts)');
    
    const decryptedToken = decrypt(dbRow.refresh_token);
    runAssert(decryptedToken === 'mock-refresh-token-888', 'Decrypted GCM refresh token matches mock value');

  } finally {
    // Restore original oauth client behavior
    google.auth.OAuth2.prototype.getToken = originalGetToken;
  }

  // ==========================================
  // TEST 6: Static Audits (No Secret Leakage & Read-Only Scopes)
  // ==========================================
  // Check scope strings are read-only
  const connectCode = fs.readFileSync(path.resolve(__dirname, '../jarvis/routes.js'), 'utf8');
  runAssert(connectCode.includes('https://www.googleapis.com/auth/gmail.readonly'), 'Gmail scope is strictly read-only');
  runAssert(connectCode.includes('https://www.googleapis.com/auth/drive.metadata.readonly'), 'Drive scope is strictly read-only metadata');
  
  // Scopes must NOT have write permissions
  runAssert(!connectCode.includes('https://www.googleapis.com/auth/gmail.send') &&
            !connectCode.includes('https://www.googleapis.com/auth/gmail.modify') &&
            !connectCode.includes('https://www.googleapis.com/auth/gmail.compose') &&
            !connectCode.includes('https://www.googleapis.com/auth/drive\n') &&
            !connectCode.includes('https://www.googleapis.com/auth/drive.file'), 
            'Contains no Google write scopes');

  // Verify that secrets are not printed in any response
  runAssert(!connectRes.data.includes(process.env.GOOGLE_CLIENT_SECRET) &&
            !connectRes.data.includes(process.env.JARVIS_ENCRYPTION_KEY),
            'Connect response does not leak secrets');

  console.log(`\n🎉 Phase 5B.1 Validation Complete! Passed ${testsPassed} of ${totalTests} tests.`);
}

async function run() {
  try {
    await setup();
    await runTests();
  } finally {
    await cleanup();
  }
}

run().catch(err => {
  console.error('Fatal execution error:', err.message);
  process.exit(1);
});
