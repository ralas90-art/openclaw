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

const { Client } = require('pg');
const { encrypt } = require('../jarvis/google-api');

const DB_URL = process.env.DATABASE_URL;
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

// Parse command line arguments
const args = process.argv.slice(2);
let connectorId = 'gmail';
const connIndex = args.indexOf('--connector');
if (connIndex !== -1 && args[connIndex + 1]) {
  connectorId = args[connIndex + 1];
}

async function seed() {
  console.log(`[SeedHelper] Starting secure token seeding for connector: '${connectorId}'...`);
  
  // 1. Validate connector ID
  if (connectorId !== 'gmail' && connectorId !== 'google_drive') {
    console.error(`Error: Malformed or disallowed connector ID '${connectorId}'. Only 'gmail' or 'google_drive' are permitted.`);
    process.exit(1);
  }

  // 2. Validate environment variables
  if (!DB_URL) {
    console.error('Error: DATABASE_URL environment variable is missing.');
    process.exit(1);
  }
  
  if (!process.env.JARVIS_ENCRYPTION_KEY) {
    console.error('Error: JARVIS_ENCRYPTION_KEY environment variable is missing.');
    process.exit(1);
  }

  if (!clientId || !clientSecret || !refreshToken) {
    console.error('Error: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN must be set in your environment.');
    process.exit(1);
  }

  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  try {
    // Ensure core tables exist first
    await client.query(`
      CREATE TABLE IF NOT EXISTS jarvis_connectors (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          connector_id TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          enabled BOOLEAN DEFAULT true,
          read_permissions JSONB DEFAULT '[]',
          write_permissions JSONB DEFAULT '[]',
          write_gated BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS jarvis_connector_tokens (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          connector_id TEXT UNIQUE REFERENCES jarvis_connectors(connector_id) ON DELETE CASCADE,
          access_token TEXT,
          refresh_token TEXT,
          token_type TEXT DEFAULT 'Bearer',
          expires_at TIMESTAMPTZ,
          client_id TEXT,
          client_secret TEXT,
          updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // Ensure definitions exist
    await client.query(`
      INSERT INTO jarvis_connectors (connector_id, name, enabled, read_permissions, write_permissions, write_gated)
      VALUES 
        ('gmail', 'Gmail Connector', true, '["https://www.googleapis.com/auth/gmail.readonly"]'::jsonb, '[]'::jsonb, true),
        ('google_drive', 'Google Drive Connector', true, '["https://www.googleapis.com/auth/drive.metadata.readonly"]'::jsonb, '[]'::jsonb, true)
      ON CONFLICT (connector_id) DO NOTHING;
    `);

    // Ensure schema columns exist
    await client.query(`
      ALTER TABLE jarvis_connector_tokens 
      ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_sync_status TEXT DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS rotation_status TEXT DEFAULT 'active';
    `);

    console.log('[SeedHelper] Encrypting credentials locally using AES-256-GCM...');
    const encryptedSecret = encrypt(clientSecret);
    const encryptedToken = encrypt(refreshToken);

    console.log('[SeedHelper] Writing GCM ciphertext to database...');
    await client.query(`
      INSERT INTO jarvis_connector_tokens (connector_id, client_id, client_secret, refresh_token, rotation_status, updated_at)
      VALUES ($1, $2, $3, $4, 'active', NOW())
      ON CONFLICT (connector_id) 
      DO UPDATE SET 
        client_id = EXCLUDED.client_id,
        client_secret = EXCLUDED.client_secret,
        refresh_token = EXCLUDED.refresh_token,
        rotation_status = 'active',
        updated_at = NOW();
    `, [connectorId, clientId, encryptedSecret, encryptedToken]);

    console.log(`[SeedHelper] Success! Securely seeded GCM-encrypted token for '${connectorId}'.`);
  } catch (err) {
    console.error('[SeedHelper] Seeding operation failed:', err.message);
  } finally {
    await client.end();
  }
}

seed().catch(err => {
  console.error('[SeedHelper] Fatal execution error:', err.message);
  process.exit(1);
});
