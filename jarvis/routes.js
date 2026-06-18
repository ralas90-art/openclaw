/**
 * Jarvis Routes
 * Defines API routing for Jarvis Personal Assistant
 */

const express = require('express');
const router = express.Router();
const { authenticateMobileToken, handleMobileIntake } = require('./mobile-intake');
const { getDailyBrief } = require('./controller');

function getRedirectUri(req) {
  if (process.env.PUBLIC_URL) {
    return `${process.env.PUBLIC_URL.replace(/\/$/, '')}/api/jarvis/google/callback`;
  }
  const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const host = req.headers.host;
  return `${protocol}://${host}/api/jarvis/google/callback`;
}


// POST /api/jarvis/mobile-intake
router.post('/mobile-intake', authenticateMobileToken, handleMobileIntake);

// GET /api/jarvis/daily-brief
router.get('/daily-brief', authenticateMobileToken, async (req, res) => {
  try {
    const isRefresh = req.query.refresh === 'true';
    const format = (req.query.format || 'json').trim().toLowerCase();
    
    // Call controller getDailyBrief with refresh flag
    const briefResult = await getDailyBrief(isRefresh);
    
    const todayStr = new Date().toISOString().substring(0, 10);
    
    if (format === 'siri') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(200).send(briefResult.siri_summary);
    } else if (format === 'markdown') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(200).send(briefResult.raw_brief_markdown);
    } else {
      // Default: json
      return res.status(200).json({
        success: true,
        brief_date: todayStr,
        raw_brief_markdown: briefResult.raw_brief_markdown,
        siri_summary: briefResult.siri_summary
      });
    }
  } catch (err) {
    console.error('[DailyBrief API Error]', err.message);
    // Secure error response: do not leak token hashes, internal DB errors, or stack traces
    return res.status(500).json({ error: 'Internal server error fetching daily brief' });
  }
});

// GET /api/jarvis/google/connect
router.get('/google/connect', async (req, res) => {
  const authHeader = req.headers.authorization;
  const headerToken = authHeader && authHeader.split(' ')[1];
  const queryToken = req.query.token;
  const token = headerToken || queryToken;

  if (!token || token !== process.env.INTERNAL_ADMIN_TOKEN) {
    return res.status(401).send('<h1>401 Unauthorized</h1><p>Invalid or missing admin token.</p>');
  }

  const connectorId = req.query.connector;
  if (connectorId !== 'gmail' && connectorId !== 'google_drive') {
    return res.status(400).send('<h1>400 Bad Request</h1><p>Invalid or missing connector ID. Only "gmail" or "google_drive" are supported.</p>');
  }

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).send('<h1>500 Internal Server Error</h1><p>GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not configured on the server.</p>');
  }

  try {
    const redirectUri = getRedirectUri(req);

    const { google } = require('googleapis');
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );

    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha256', process.env.JARVIS_ENCRYPTION_KEY || 'fallback-key');
    hmac.update(`${connectorId}:${expiresAt}`);
    const signature = hmac.digest('hex');
    const state = `${connectorId}:${expiresAt}:${signature}`;

    const scopes = connectorId === 'gmail'
      ? ['https://www.googleapis.com/auth/gmail.readonly']
      : ['https://www.googleapis.com/auth/drive.metadata.readonly'];

    const authUrlOptions = {
      access_type: 'offline',
      scope: scopes,
      state: state
    };

    if (req.query.force === 'true') {
      authUrlOptions.prompt = 'consent';
    }

    const url = oauth2Client.generateAuthUrl(authUrlOptions);
    return res.redirect(url);
  } catch (err) {
    console.error('[OAuth Connect Error]', err.message);
    return res.status(500).send('<h1>500 Internal Server Error</h1><p>Failed to generate Google authorization URL.</p>');
  }
});

// GET /api/jarvis/google/callback
router.get('/google/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) {
    return res.status(400).send('<h1>400 Bad Request</h1><p>Missing auth code or state parameter.</p>');
  }

  const parts = state.split(':');
  if (parts.length !== 3) {
    return res.status(400).send('<h1>400 Bad Request</h1><p>Malformed state parameter.</p>');
  }

  const [connectorId, expiresAtStr, signature] = parts;
  const expiresAt = parseInt(expiresAtStr, 10);

  if (Date.now() > expiresAt) {
    return res.status(400).send('<h1>400 Bad Request</h1><p>OAuth session has expired. Please try again.</p>');
  }

  const crypto = require('crypto');
  const hmac = crypto.createHmac('sha256', process.env.JARVIS_ENCRYPTION_KEY || 'fallback-key');
  hmac.update(`${connectorId}:${expiresAt}`);
  const expectedSignature = hmac.digest('hex');

  if (signature !== expectedSignature) {
    return res.status(400).send('<h1>400 Bad Request</h1><p>Invalid state signature. Safety validation failed.</p>');
  }

  try {
    const redirectUri = getRedirectUri(req);

    const { google } = require('googleapis');
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );

    const { tokens } = await oauth2Client.getToken(code);
    let refreshToken = tokens.refresh_token;

    const { queryDb } = require('./controller');
    const { encrypt, decrypt } = require('./google-api');

    if (!refreshToken) {
      const existing = await queryDb(
        `SELECT refresh_token FROM jarvis_connector_tokens WHERE connector_id = $1;`,
        [connectorId]
      );
      if (existing.length > 0 && existing[0].refresh_token) {
        const decryptedToken = decrypt(existing[0].refresh_token);
        if (decryptedToken) {
          refreshToken = decryptedToken;
        } else {
          refreshToken = existing[0].refresh_token;
        }
      }
    }

    if (!refreshToken) {
      return res.status(400).send(
        `<h1>Missing Refresh Token</h1>` +
        `<p>Google did not return a refresh token. This happens if you have already authorized this application.</p>` +
        `<p>Please return to Telegram and reconnect using the <strong>force</strong> option, or click: </p>` +
        `<p><a href="/api/jarvis/google/connect?connector=${connectorId}&token=${process.env.INTERNAL_ADMIN_TOKEN}&force=true">Force Consent & Reconnect</a></p>`
      );
    }

    const encryptedSecret = encrypt(process.env.GOOGLE_CLIENT_SECRET);
    const encryptedToken = encrypt(refreshToken);

    await queryDb(`
      INSERT INTO jarvis_connector_tokens (connector_id, client_id, client_secret, refresh_token, rotation_status, last_sync_status, last_used_at, updated_at)
      VALUES ($1, $2, $3, $4, 'active', 'connected', NOW(), NOW())
      ON CONFLICT (connector_id)
      DO UPDATE SET
        client_id = EXCLUDED.client_id,
        client_secret = EXCLUDED.client_secret,
        refresh_token = EXCLUDED.refresh_token,
        rotation_status = 'active',
        last_sync_status = 'connected',
        last_used_at = NOW(),
        updated_at = NOW();
    `, [connectorId, process.env.GOOGLE_CLIENT_ID, encryptedSecret, encryptedToken]);

    return res.status(200).send(
      `<h1>Success</h1>` +
      `<p>Google ${connectorId === 'gmail' ? 'Gmail' : 'Google Drive'} connector connected successfully.</p>` +
      `<p>You can return to Telegram.</p>`
    );
  } catch (err) {
    console.error('[OAuth Callback Error]', err.message);
    return res.status(500).send('<h1>500 Internal Server Error</h1><p>Failed to exchange auth code for tokens.</p>');
  }
});

module.exports = router;
