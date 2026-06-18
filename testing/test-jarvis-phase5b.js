const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from .env.local if present, otherwise .env
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

const assert = require('assert');
const { Client } = require('pg');
const { handleCommand } = require('../interfaces/telegram/handlers');
const { getGoogleAuthClient, handleAuthFailure, encrypt, decrypt } = require('../jarvis/google-api');
const connectorsSummary = require('../jarvis/connectors-summary');

const DB_URL = process.env.DATABASE_URL;
let client;

async function setup() {
  console.log('Setting up Phase 5B validation...');
  if (!DB_URL) {
    console.error('Error: DATABASE_URL is not set.');
    process.exit(1);
  }

  client = new Client({ connectionString: DB_URL });
  await client.connect();

  // Ensure tables exist first
  await connectorsSummary.seedInitialConnectors();

  // Clear existing mock connectors to prevent conflict
  await client.query("DELETE FROM jarvis_connector_tokens WHERE connector_id IN ('gmail', 'google_drive');");
  await client.query("DELETE FROM jarvis_connectors WHERE connector_id IN ('gmail', 'google_drive');");

  // Re-seed connector definitions so foreign keys are satisfied
  await connectorsSummary.seedInitialConnectors();
}

async function cleanup() {
  console.log('\nCleaning up Phase 5B validation resources...');
  if (client) {
    try {
      await client.query("DELETE FROM jarvis_connector_tokens WHERE connector_id IN ('gmail', 'google_drive');");
      await client.query("DELETE FROM jarvis_connectors WHERE connector_id IN ('gmail', 'google_drive');");
      await client.end();
    } catch (err) {
      console.error('[Cleanup DB Error]', err.message);
    }
  }
  console.log('Cleanup completed.');
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

  const mockMessage = {
    chat: { id: 12345 },
    from: { id: 12345 }
  };

  // ==========================================
  // TEST 1: Cryptographic Encryption/Decryption
  // ==========================================
  const plaintext = 'test-secret-value-123!';
  const ciphertext = encrypt(plaintext);
  
  runAssert(ciphertext !== plaintext, 'Ciphertext is not equal to plaintext');
  runAssert(ciphertext.includes(':'), 'Ciphertext contains IV/authTag separators');
  
  const cipherParts = ciphertext.split(':');
  runAssert(cipherParts.length === 3, 'GCM Ciphertext contains exactly 3 parts (iv:authTag:ciphertext)');
  
  const decrypted = decrypt(ciphertext);
  runAssert(decrypted === plaintext, 'Decrypted GCM value matches original plaintext');

  // Verify legacy CBC decryption fallback
  const crypto = require('crypto');
  const key = crypto.createHash('sha256').update(process.env.JARVIS_ENCRYPTION_KEY || process.env.DATABASE_URL || 'fallback-key-for-local-testing-only-12345').digest();
  const ivCbc = crypto.randomBytes(16);
  const cipherCbc = crypto.createCipheriv('aes-256-cbc', key, ivCbc);
  let legacyCipher = cipherCbc.update('legacy-cbc-raw-123', 'utf8', 'hex');
  legacyCipher += cipherCbc.final('hex');
  const legacyCbcString = ivCbc.toString('hex') + ':' + legacyCipher;

  const decryptedLegacy = decrypt(legacyCbcString);
  runAssert(decryptedLegacy === 'legacy-cbc-raw-123', 'Decryption fallback decrypts legacy CBC strings successfully');

  // Check invalid decrypt fails closed (returns null)
  const tamperedCipher = ciphertext.substring(0, ciphertext.length - 4) + '0000';
  const invalidDecrypted = decrypt(tamperedCipher);
  runAssert(invalidDecrypted === null, 'Decrypting invalid GCM cipher text fails closed by returning null');

  // Check plaintext fallback
  const plainFallback = decrypt('simple-plaintext-token');
  runAssert(plainFallback === 'simple-plaintext-token', 'Decrypting raw plaintext returns it as-is');

  // ==========================================
  // TEST 2: Auto-Migration to GCM Encrypted Credentials
  // ==========================================
  // Insert legacy CBC client secret and plaintext refresh token to verify dual auto-migration
  const testClientId = 'client_123';
  const testClientSecret = 'secret_abc_xyz';
  const testRefreshToken = 'refresh_789_qwe';

  // 1. Encrypt client secret using legacy CBC
  const ivCbc2 = crypto.randomBytes(16);
  const cipherCbc2 = crypto.createCipheriv('aes-256-cbc', key, ivCbc2);
  let legacyCipher2 = cipherCbc2.update(testClientSecret, 'utf8', 'hex');
  legacyCipher2 += cipherCbc2.final('hex');
  const legacyCbcSecretText = ivCbc2.toString('hex') + ':' + legacyCipher2;

  // 2. Insert CBC secret and plaintext refresh token
  await client.query(
    `INSERT INTO jarvis_connector_tokens (connector_id, client_id, client_secret, refresh_token, rotation_status)
     VALUES ('gmail', $1, $2, $3, 'active');`,
    [testClientId, legacyCbcSecretText, testRefreshToken]
  );

  // Retrieve auth client which should trigger auto-encryption & upgrade to GCM
  const oauthClient = await getGoogleAuthClient('gmail');
  runAssert(oauthClient !== null, 'Successfully generated Google OAuth client');

  // Retrieve database row and assert it is now encrypted with GCM (3 parts)
  const rows = await client.query(
    "SELECT client_secret, refresh_token FROM jarvis_connector_tokens WHERE connector_id = 'gmail';"
  );
  
  const updatedRow = rows.rows[0];
  runAssert(updatedRow.client_secret !== legacyCbcSecretText, 'Client secret is upgraded from legacy CBC');
  runAssert(updatedRow.refresh_token !== testRefreshToken, 'Refresh token in DB is no longer plaintext');
  
  const updatedSecretParts = updatedRow.client_secret.split(':');
  const updatedTokenParts = updatedRow.refresh_token.split(':');
  
  runAssert(updatedSecretParts.length === 3, 'Client secret is migrated to GCM (3 parts)');
  runAssert(updatedTokenParts.length === 3, 'Refresh token is migrated to GCM (3 parts)');

  // Decrypt database GCM values to ensure they match original raw values
  const decryptedSecret = decrypt(updatedRow.client_secret);
  const decryptedToken = decrypt(updatedRow.refresh_token);
  runAssert(decryptedSecret === testClientSecret, 'Decrypted GCM database client secret matches original');
  runAssert(decryptedToken === testRefreshToken, 'Decrypted GCM database refresh token matches original');

  // ==========================================
  // TEST 3: Revocation Gating & Fail-Closed
  // ==========================================
  // Trigger auth failure which should mark token as revoked
  await handleAuthFailure('gmail');

  const revokedRow = await client.query(
    "SELECT rotation_status, last_sync_status FROM jarvis_connector_tokens WHERE connector_id = 'gmail';"
  );
  runAssert(revokedRow.rows[0].rotation_status === 'revoked', 'Rotation status is marked as revoked');
  runAssert(revokedRow.rows[0].last_sync_status === 'auth_failed', 'Last sync status is marked as auth_failed');

  // Ensure getting client fails closed
  const clientAfterRevocation = await getGoogleAuthClient('gmail');
  runAssert(clientAfterRevocation === null, 'Retrieving oauth client for revoked token returns null (fails closed)');

  // ==========================================
  // TEST 4: Output / View Non-Leakage Validation
  // ==========================================
  const connectorsRes = await handleCommand('/jarvis_connectors', mockMessage);
  runAssert(connectorsRes.includes('Jarvis Cloud Connectors Status'), 'Connectors command prints header');
  runAssert(!connectorsRes.includes(testClientSecret), 'Connector status screen does not leak client secret');
  runAssert(!connectorsRes.includes(testRefreshToken), 'Connector status screen does not leak refresh token');

  // ==========================================
  // TEST 5: Static Audit for Token Leakage in Logging / Output
  // ==========================================
  const filesToAudit = [
    path.resolve(__dirname, '../jarvis/google-api.js'),
    path.resolve(__dirname, '../jarvis/connectors-summary.js'),
    path.resolve(__dirname, '../interfaces/telegram/handlers.js')
  ];

  for (const file of filesToAudit) {
    const code = fs.readFileSync(file, 'utf8');
    // We should not be doing console.log/info on decrypted token contents or tokens
    runAssert(!code.includes('console.log(finalRefreshToken)'), `File ${path.basename(file)} does not print refresh token`);
    runAssert(!code.includes('console.log(finalClientSecret)'), `File ${path.basename(file)} does not print client secret`);
    runAssert(!code.includes('console.log(decrypt'), `File ${path.basename(file)} does not print decrypted expressions`);
  }

  // ==========================================
  // TEST 6: Production fail-closed on missing encryption key
  // ==========================================
  const prevNodeEnv = process.env.NODE_ENV;
  const prevKey = process.env.JARVIS_ENCRYPTION_KEY;
  
  process.env.NODE_ENV = 'production';
  delete process.env.JARVIS_ENCRYPTION_KEY;
  
  try {
    encrypt('fail-test');
    runAssert(false, 'Should throw error in production mode if key is missing');
  } catch (err) {
    runAssert(err.message.includes('JARVIS_ENCRYPTION_KEY is missing'), 'Encryption throws missing key error in production');
  }

  // Restore variables
  process.env.NODE_ENV = prevNodeEnv;
  if (prevKey) {
    process.env.JARVIS_ENCRYPTION_KEY = prevKey;
  }

  // ==========================================
  // TEST 7: Integration Check of Seed and Verify Scripts
  // ==========================================
  const { execSync } = require('child_process');
  
  // Clean DB for the test
  await client.query("DELETE FROM jarvis_connector_tokens WHERE connector_id IN ('gmail', 'google_drive');");

  // 1. Missing env vars fail safely
  try {
    execSync(`node scripts/seed-google-connector-token.js --connector gmail`, {
      env: { ...process.env, DATABASE_URL: '' },
      stdio: 'pipe'
    });
    runAssert(false, 'Seeding should fail when DATABASE_URL is missing');
  } catch (err) {
    const output = (err.stderr || '').toString() + (err.stdout || '').toString();
    runAssert(output.includes('DATABASE_URL environment variable is missing'), 'Seed helper fails safely on missing env');
  }

  // 2. Malformed connector ID fails safely
  try {
    execSync(`node scripts/seed-google-connector-token.js --connector malformed_connector`, {
      env: process.env,
      stdio: 'pipe'
    });
    runAssert(false, 'Seeding should fail on malformed connector id');
  } catch (err) {
    const output = (err.stderr || '').toString() + (err.stdout || '').toString();
    runAssert(output.includes('disallowed connector ID'), 'Seed helper fails safely on malformed connector id');
  }

  // 3. Encrypted seed succeeds
  const seedEnv = {
    ...process.env,
    GOOGLE_CLIENT_ID: 'seed_client_id',
    GOOGLE_CLIENT_SECRET: 'seed_client_secret',
    GOOGLE_REFRESH_TOKEN: 'seed_refresh_token'
  };

  const seedOutput = execSync(`node scripts/seed-google-connector-token.js --connector gmail`, {
    env: seedEnv
  }).toString();
  
  runAssert(seedOutput.includes('Success! Securely seeded GCM-encrypted token'), 'Seed script succeeds with GCM');
  runAssert(!seedOutput.includes('seed_client_secret') && !seedOutput.includes('seed_refresh_token'), 'Seed script output does not leak raw secrets');

  // Seed drive too to check both GCM format
  execSync(`node scripts/seed-google-connector-token.js --connector google_drive`, {
    env: seedEnv
  });

  // 4. GCM format verification works
  const verifyOutput = execSync(`node scripts/verify-google-connector-token.js`, {
    env: process.env
  }).toString();

  runAssert(verifyOutput.includes('Refresh Token Encrypted (AES-GCM): ✅ YES'), 'Verify script reports refresh token encrypted');
  runAssert(verifyOutput.includes('Client Secret Encrypted (AES-GCM): ✅ YES'), 'Verify script reports client secret encrypted');
  runAssert(!verifyOutput.includes('seed_client_secret') && !verifyOutput.includes('seed_refresh_token'), 'Verify script output does not leak raw secrets');

  console.log(`\n🎉 Phase 5B Validation Complete! Passed ${testsPassed} of ${totalTests} tests.`);
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
