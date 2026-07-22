/**
 * Jarvis Google API Authentication Helper
 * Handles OAuth2 client instantiation for Gmail and Google Drive integration
 */

const { google } = require('googleapis');
const crypto = require('crypto');
const { queryDb } = require('./db');
const { sanitizeSecrets, sanitizeError } = require('./sanitizer');


/**
 * Derives a 32-byte encryption key from environment variables
 */
function getEncryptionKey() {
  const keyBase = process.env.JARVIS_ENCRYPTION_KEY;
  if (!keyBase) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Encryption failed: JARVIS_ENCRYPTION_KEY is missing in production.');
    }
    // Fallback for non-production environments
    const fallback = process.env.DATABASE_URL || 'fallback-key-for-local-testing-only-12345';
    return crypto.createHash('sha256').update(fallback).digest();
  }
  return crypto.createHash('sha256').update(keyBase).digest();
}

/**
 * Encrypts raw text using aes-256-gcm (returns iv:authTag:ciphertext)
 */
function encrypt(text) {
  if (!text) return text;
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12); // GCM standard IV is 12 bytes
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return iv.toString('hex') + ':' + authTag + ':' + encrypted;
  } catch (err) {
    console.error('[GoogleAPI] Encryption failed:', err.message);
    throw err;
  }
}

/**
 * Decrypts text using aes-256-gcm (with legacy aes-256-cbc fallback)
 */
function decrypt(text) {
  if (!text) return text;
  if (!text.includes(':')) {
    return text;
  }
  const parts = text.split(':');
  const hexRegex = /^[0-9a-fA-F]+$/;
  if (!parts.every(p => hexRegex.test(p))) {
    return text;
  }

  // 1. GCM Decryption (3 parts: iv:authTag:ciphertext)
  if (parts.length === 3) {
    try {
      const key = getEncryptionKey();
      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encryptedText = Buffer.from(parts[2], 'hex');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err) {
      console.error('[GoogleAPI] GCM Decryption failed:', err.message);
      return null;
    }
  }

  // 2. Legacy CBC Decryption (2 parts: iv:ciphertext)
  if (parts.length === 2) {
    try {
      const key = getEncryptionKey();
      const iv = Buffer.from(parts[0], 'hex');
      const encryptedText = Buffer.from(parts[1], 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err) {
      console.error('[GoogleAPI] Legacy CBC Decryption failed:', err.message);
      return null;
    }
  }

  return text;
}

/**
 * Checks if a string is encrypted in the AES-GCM format (iv:authTag:ciphertext)
 */
function isEncrypted(text) {
  if (!text) return false;
  if (!text.includes(':')) return false;
  const parts = text.split(':');
  if (parts.length !== 3) return false;
  const hexRegex = /^[0-9a-fA-F]+$/;
  return parts.every(p => hexRegex.test(p));
}

/**
 * Updates connector token state
 */
async function updateTokenStatus(rowId, syncStatus, rotationStatus) {
  try {
    await queryDb(
      `UPDATE jarvis_connector_tokens 
       SET last_sync_status = $1, rotation_status = $2, updated_at = NOW() 
       WHERE id = $3;`,
      [syncStatus, rotationStatus, rowId]
    );
  } catch (err) {
    console.error('[GoogleAPI] Failed to update token status:', err.message);
  }
}

/**
 * Marks token as revoked on auth failure
 */
async function handleAuthFailure(connectorId) {
  console.warn(`[GoogleAPI] Authentication failed for ${connectorId}. Marking token as revoked.`);
  try {
    await queryDb(
      `UPDATE jarvis_connector_tokens 
       SET last_sync_status = 'auth_failed', rotation_status = 'revoked', updated_at = NOW() 
       WHERE connector_id = $1 OR (connector_id = 'google' AND $1 = 'google');`,
      [connectorId]
    );
  } catch (err) {
    console.error('[GoogleAPI] Failed to mark token as revoked:', err.message);
  }
}

/**
 * Resolves credentials for a given connector ID and returns an authenticated OAuth2 client
 * @param {string} connectorId - 'gmail', 'google_drive', etc.
 * @returns {Promise<object|null>}
 */
async function getGoogleAuthClient(connectorId = 'google') {
  console.log(`[GoogleAPI] Resolving credentials for connector: ${connectorId}...`);
  
  let clientId = process.env.GOOGLE_CLIENT_ID;
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  let refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  let usingDb = false;
  let dbRow = null;

  // Try fetching from the database first
  try {
    const rows = await queryDb(
      `SELECT id, access_token, refresh_token, client_id, client_secret, rotation_status 
       FROM jarvis_connector_tokens 
       WHERE connector_id = $1 OR connector_id = 'google';`,
      [connectorId]
    );
    
    if (rows.length > 0) {
      dbRow = rows[0];
      
      if (dbRow.rotation_status === 'revoked') {
        console.warn(`[GoogleAPI] Connector ${connectorId} is marked as revoked.`);
        return null;
      }

      usingDb = true;
      if (dbRow.client_id) clientId = dbRow.client_id;
      if (dbRow.client_secret) clientSecret = dbRow.client_secret;
      if (dbRow.refresh_token) refreshToken = dbRow.refresh_token;
    }
  } catch (err) {
    console.warn('[GoogleAPI] DB token query warning:', err.message);
  }

  if (!clientId || !clientSecret || !refreshToken) {
    console.warn(`[GoogleAPI] Missing credentials for ${connectorId}. Client ID, secret, or refresh token is not configured.`);
    return null;
  }

  let finalClientId = clientId;
  let finalClientSecret = clientSecret;
  let finalRefreshToken = refreshToken;

  if (usingDb && dbRow) {
    const isSecretEncrypted = isEncrypted(clientSecret);
    const isTokenEncrypted = isEncrypted(refreshToken);

    if (isSecretEncrypted) {
      finalClientSecret = decrypt(clientSecret);
      if (finalClientSecret === null) {
        console.error('[GoogleAPI] Failed to decrypt client secret. Failing closed.');
        await updateTokenStatus(dbRow.id, 'decryption_error', 'revoked');
        return null;
      }
    }
    
    if (isTokenEncrypted) {
      finalRefreshToken = decrypt(refreshToken);
      if (finalRefreshToken === null) {
        console.error('[GoogleAPI] Failed to decrypt refresh token. Failing closed.');
        await updateTokenStatus(dbRow.id, 'decryption_error', 'revoked');
        return null;
      }
    }

    // Auto-migration to GCM encrypted credentials
    if (!isSecretEncrypted || !isTokenEncrypted) {
      console.log('[GoogleAPI] Plaintext or legacy CBC credentials found in DB. Auto-encrypting to AES-GCM...');
      const rawSecret = isSecretEncrypted ? finalClientSecret : decrypt(clientSecret);
      const rawToken = isTokenEncrypted ? finalRefreshToken : decrypt(refreshToken);

      if (rawSecret === null || rawToken === null) {
        console.error('[GoogleAPI] Decryption failed during auto-migration. Failing closed.');
        await updateTokenStatus(dbRow.id, 'decryption_error', 'revoked');
        return null;
      }

      finalClientSecret = rawSecret;
      finalRefreshToken = rawToken;

      const encryptedSecret = encrypt(rawSecret);
      const encryptedToken = encrypt(rawToken);
      
      try {
        await queryDb(
          `UPDATE jarvis_connector_tokens 
           SET client_secret = $1, refresh_token = $2, updated_at = NOW() 
           WHERE id = $3;`,
          [encryptedSecret, encryptedToken, dbRow.id]
        );
        console.log('[GoogleAPI] DB credentials successfully migrated to AES-GCM.');
      } catch (err) {
        console.error('[GoogleAPI] Failed to save GCM-encrypted credentials:', err.message);
      }
    }

    // Update last_used_at
    try {
      await queryDb(
        `UPDATE jarvis_connector_tokens SET last_used_at = NOW() WHERE id = $1;`,
        [dbRow.id]
      );
    } catch (e) {
      // Ignore sync logging errors
    }
  }

  // Create Google OAuth2 client
  const oauth2Client = new google.auth.OAuth2(
    finalClientId,
    finalClientSecret,
    'http://localhost'
  );

  oauth2Client.setCredentials({
    refresh_token: finalRefreshToken
  });

  return oauth2Client;
}

module.exports = {
  getGoogleAuthClient,
  handleAuthFailure,
  encrypt,
  decrypt
};

