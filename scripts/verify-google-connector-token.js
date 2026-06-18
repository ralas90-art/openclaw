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

const DB_URL = process.env.DATABASE_URL;

function isGcmFormat(text) {
  if (!text) return false;
  if (!text.includes(':')) return false;
  const parts = text.split(':');
  if (parts.length !== 3) return false;
  const hexRegex = /^[0-9a-fA-F]+$/;
  return parts.every(p => hexRegex.test(p));
}

async function verify() {
  if (!DB_URL) {
    console.error('Error: DATABASE_URL environment variable is missing.');
    process.exit(1);
  }

  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  try {
    const res = await client.query(
      `SELECT connector_id, rotation_status, last_sync_status, last_used_at, refresh_token, client_secret 
       FROM jarvis_connector_tokens 
       WHERE connector_id IN ('gmail', 'google_drive');`
    );

    console.log('\n🔒 *Jarvis Connector Security Audit*');
    console.log('====================================');
    
    if (res.rows.length === 0) {
      console.log('No connector tokens registered in jarvis_connector_tokens.');
      return;
    }

    for (const row of res.rows) {
      const rfGcm = isGcmFormat(row.refresh_token);
      const csGcm = isGcmFormat(row.client_secret);
      
      console.log(`\n• Connector ID: ${row.connector_id}`);
      console.log(`  - Status: ${row.rotation_status || 'active'}`);
      console.log(`  - Last Sync Status: ${row.last_sync_status || 'unknown'}`);
      console.log(`  - Last Used At: ${row.last_used_at || 'never'}`);
      console.log(`  - Refresh Token Encrypted (AES-GCM): ${rfGcm ? '✅ YES (gcm_format)' : '❌ NO'}`);
      console.log(`  - Client Secret Encrypted (AES-GCM): ${csGcm ? '✅ YES (gcm_format)' : '❌ NO'}`);
    }
    console.log('\n====================================');
  } catch (err) {
    console.error('Audit failed:', err.message);
  } finally {
    await client.end();
  }
}

verify().catch(err => {
  console.error('Fatal execution error:', err.message);
  process.exit(1);
});
