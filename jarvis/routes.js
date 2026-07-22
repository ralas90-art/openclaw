/**
 * Jarvis Routes
 * Defines API routing for Jarvis Personal Assistant
 */

const express = require('express');
const router = express.Router();
const { authenticateMobileToken, handleMobileIntake } = require('./mobile-intake');
const { getDailyBrief } = require('./controller');

function cleanPublicUrl(url) {
  if (!url) return '';
  let cleaned = url.replace(/^["']|["']$/g, '').trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(cleaned);
    if (parsed.pathname !== '/' && parsed.pathname !== '') {
      console.error(`❌ [PUBLIC_URL Check] Rejected PUBLIC_URL "${url}" because it contains a path suffix: "${parsed.pathname}". PUBLIC_URL must be the base domain only!`);
      return '';
    }
    return cleaned;
  } catch (err) {
    console.error(`❌ [PUBLIC_URL Check] Rejected PUBLIC_URL "${url}" because it is not a valid URL: ${err.message}`);
    return '';
  }
}

function getRedirectUri(req) {
  const publicUrl = cleanPublicUrl(process.env.PUBLIC_URL);
  if (publicUrl) {
    return `${publicUrl}/api/jarvis/google/callback`;
  }
  const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const host = req.headers.host;
  return `${protocol}://${host}/api/jarvis/google/callback`;
}const {
  safeTimingEqual,
  checkTicketRateLimit,
  createAuthTicket,
  validateAndConsumeTicket,
  createSessionToken,
  validateSessionToken
} = require('./auth-tickets');

// Middleware to authenticate either admin token or active session token
async function authenticateAdminSession(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: missing bearer token' });
  }

  if (process.env.INTERNAL_ADMIN_TOKEN && safeTimingEqual(token, process.env.INTERNAL_ADMIN_TOKEN)) {
    return next();
  }

  const sessionResult = await validateSessionToken(token);
  if (sessionResult.valid) {
    req.sessionMetadata = sessionResult.metadata;
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized: invalid or expired session token' });
}

async function authenticateAnyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  
  if (token) {
    if (process.env.INTERNAL_ADMIN_TOKEN && safeTimingEqual(token, process.env.INTERNAL_ADMIN_TOKEN)) {
      return next();
    }
    const sessionResult = await validateSessionToken(token);
    if (sessionResult.valid) {
      req.sessionMetadata = sessionResult.metadata;
      return next();
    }
  }
  return authenticateMobileToken(req, res, next);
}

// POST /api/jarvis/auth/exchange-ticket
router.post('/auth/exchange-ticket', async (req, res) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown_ip';
  if (!checkTicketRateLimit(`exchange_${ip}`, 20, 60000)) {
    return res.status(429).json({ success: false, error: 'Rate limit exceeded' });
  }

  const { ticket } = req.body || {};
  if (!ticket || typeof ticket !== 'string') {
    return res.status(400).json({ success: false, error: 'Ticket parameter is required' });
  }

  const validation = await validateAndConsumeTicket(ticket, 'dashboard_access');
  if (!validation.valid) {
    return res.status(401).json({ success: false, error: validation.reason || 'Ticket exchange failed' });
  }

  try {
    const sessionToken = await createSessionToken(validation.metadata || {}, 3600);
    return res.status(200).json({
      success: true,
      session_token: sessionToken,
      expires_in: 3600
    });
  } catch (err) {
    console.error('[AuthExchange Error]', err.message);
    return res.status(500).json({ success: false, error: 'Failed to issue session token' });
  }
});

// POST /api/jarvis/google/connect-ticket
router.post('/google/connect-ticket', authenticateAdminSession, async (req, res) => {
  const { connector } = req.body || {};
  if (connector !== 'gmail' && connector !== 'google_drive') {
    return res.status(400).json({ success: false, error: 'Invalid connector ID' });
  }

  try {
    const ticket = await createAuthTicket('google_oauth_connect', { connector }, 300);
    return res.status(200).json({ success: true, ticket });
  } catch (err) {
    console.error('[ConnectTicket Error]', err.message);
    return res.status(500).json({ success: false, error: 'Failed to issue OAuth connect ticket' });
  }
});

// POST /api/jarvis/mobile-intake
router.post('/mobile-intake', authenticateMobileToken, handleMobileIntake);

// GET /api/jarvis/daily-brief
router.get('/daily-brief', authenticateAnyToken, async (req, res) => {
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
  const ticket = req.query.ticket;
  if (!ticket) {
    return res.status(400).send('<h1>400 Bad Request</h1><p>Missing auth ticket parameter.</p>');
  }

  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown_ip';
  if (!checkTicketRateLimit(`connect_${ip}`, 10, 60000)) {
    return res.status(429).send('<h1>429 Rate Limit Exceeded</h1><p>Too many connection attempts.</p>');
  }

  const validation = await validateAndConsumeTicket(ticket, 'google_oauth_connect');
  if (!validation.valid) {
    return res.status(401).send(`<h1>401 Unauthorized</h1><p>${validation.reason || 'Invalid or expired ticket'}</p>`);
  }

  const connectorId = validation.metadata && validation.metadata.connector;
  if (connectorId !== 'gmail' && connectorId !== 'google_drive') {
    return res.status(400).send('<h1>400 Bad Request</h1><p>Invalid connector specified in ticket.</p>');
  }

  const encryptionKey = process.env.JARVIS_ENCRYPTION_KEY;
  if (!encryptionKey) {
    return res.status(500).send('<h1>500 Internal Server Error</h1><p>JARVIS_ENCRYPTION_KEY is missing on server.</p>');
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
    const hmac = crypto.createHmac('sha256', encryptionKey);
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

  const encryptionKey = process.env.JARVIS_ENCRYPTION_KEY;
  if (!encryptionKey) {
    return res.status(500).send('<h1>500 Internal Server Error</h1><p>JARVIS_ENCRYPTION_KEY is missing on server.</p>');
  }

  const crypto = require('crypto');
  const hmac = crypto.createHmac('sha256', encryptionKey);
  hmac.update(`${connectorId}:${expiresAt}`);
  const expectedSignature = hmac.digest('hex');

  if (!safeTimingEqual(signature, expectedSignature)) {
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
        `<p>Please return to Telegram and reconnect using the <strong>force</strong> option (e.g. <code>/jarvis_reconnect_google ${connectorId} force</code>).</p>`
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

const crypto = require('crypto');

function sanitizeSecretKeywords(str) {
  if (!str) return str;
  return str
    .replace(/(bearer\s+)[a-zA-Z0-9_\-\.]+/gi, '$1••••••••')
    .replace(/(postgres:\/\/)[^@]+@/gi, '$1user:password@')
    .replace(/(api_key\s*:\s*)['\"][a-zA-Z0-9_\-]+['\"]/gi, '$1"••••••••"')
    .replace(/(client_secret\s*:\s*)['\"][a-zA-Z0-9_\-]+['\"]/gi, '$1"••••••••"');
}

function sanitizeApprovalForDisplay(r) {
  if (!r) return null;
  const clone = { ...r };
  
  if (clone.proposed_payload) {
    const payloadStr = JSON.stringify(clone.proposed_payload);
    if (payloadStr.length > 500) {
      clone.proposed_payload = {
        _info: "[truncated for display]",
        action: clone.proposed_payload.action,
        project_slug: clone.proposed_payload.project_slug,
        truncated_payload_preview: payloadStr.substring(0, 300) + "..."
      };
    }
  }
  
  if (clone.action_result_summary) {
    clone.action_result_summary = sanitizeSecretKeywords(clone.action_result_summary);
  }
  if (clone.execution_error_summary) {
    clone.execution_error_summary = sanitizeSecretKeywords(clone.execution_error_summary);
  }
  
  return clone;
}

// GET /api/jarvis/approvals
router.get('/approvals', authenticateAdminSession, async (req, res) => {
  try {
    const { queryDb, cleanupExpiredApprovals } = require('./controller');
    await cleanupExpiredApprovals();

    const { status, project_slug } = req.query;
    let sql = "SELECT * FROM jarvis_approval_requests WHERE 1=1";
    const params = [];
    
    if (status) {
      const cleanStatus = status.trim().toLowerCase();
      const validStatuses = ['pending', 'approved', 'rejected', 'cancelled', 'expired', 'executed', 'failed'];
      if (!validStatuses.includes(cleanStatus)) {
        return res.status(400).json({ error: `Invalid status filter. Must be one of: ${validStatuses.join(', ')}` });
      }
      params.push(cleanStatus);
      sql += ` AND status = $${params.length}`;
    }
    
    if (project_slug) {
      const cleanSlug = project_slug.trim().toLowerCase();
      params.push(cleanSlug);
      sql += ` AND project_slug = $${params.length}`;
    }
    
    sql += " ORDER BY created_at DESC LIMIT 50;";
    
    const rows = await queryDb(sql, params);
    const sanitizedRows = rows.map(r => sanitizeApprovalForDisplay(r));
    return res.status(200).json(sanitizedRows);
  } catch (err) {
    console.error('[Approvals API Error]', err.message);
    return res.status(500).json({ error: 'Internal server error listing approvals' });
  }
});

// GET /api/jarvis/approvals/:id
router.get('/approvals/:id', authenticateAdminSession, async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(400).json({ error: "Invalid ID format. Must be a valid UUID." });
    }

    const { queryDb, cleanupExpiredApprovals } = require('./controller');
    await cleanupExpiredApprovals();

    const rows = await queryDb("SELECT * FROM jarvis_approval_requests WHERE id = $1;", [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Approval request not found" });
    }
    
    const auditEvents = await queryDb(
      "SELECT * FROM jarvis_approval_audit_events WHERE approval_id = $1 ORDER BY created_at ASC;",
      [id]
    );
    
    const sanitizedReq = sanitizeApprovalForDisplay(rows[0]);
    return res.status(200).json({
      ...sanitizedReq,
      audit_events: auditEvents
    });
  } catch (err) {
    console.error('[Approval Detail API Error]', err.message);
    return res.status(500).json({ error: 'Internal server error fetching approval details' });
  }
});

// POST /api/jarvis/approvals/:id/approve
router.post('/approvals/:id/approve', authenticateAdminSession, async (req, res) => {
  const { id } = req.params;
  try {
    const { approveRequest, executeApprovedAction } = require('./controller');
    await approveRequest(id, 'admin_dashboard');
    const result = await executeApprovedAction(id, 'admin_dashboard');
    return res.status(200).json({ success: true, message: 'Action approved and executed successfully', result });
  } catch (err) {
    console.error('[Approve Route Error]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/jarvis/approvals/:id/reject
router.post('/approvals/:id/reject', authenticateAdminSession, async (req, res) => {
  const { id } = req.params;
  try {
    const { rejectApproval } = require('./controller');
    await rejectApproval(id, 'admin_dashboard');
    return res.status(200).json({ success: true, message: 'Action proposal rejected' });
  } catch (err) {
    console.error('[Reject Route Error]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/jarvis/approvals/:id/cancel
router.post('/approvals/:id/cancel', authenticateAdminSession, async (req, res) => {
  const { id } = req.params;
  try {
    const { cancelApproval } = require('./controller');
    await cancelApproval(id, 'admin_dashboard');
    return res.status(200).json({ success: true, message: 'Action proposal cancelled' });
  } catch (err) {
    console.error('[Cancel Route Error]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/jarvis/priorities/:id/propose
router.post('/priorities/:id/propose', authenticateAdminSession, async (req, res) => {
  const { id } = req.params;
  try {
    const { proposeAction } = require('./controller');
    const proposal = await proposeAction(id, 'admin_dashboard');
    return res.status(200).json({ success: true, message: 'Action proposed successfully', proposal });
  } catch (err) {
    console.error('[Propose Route Error]', err.message);
    return res.status(500).json({ error: err.message });
  }
});


// GET /api/jarvis/approval-stats
router.get('/approval-stats', authenticateAdminSession, async (req, res) => {
  try {
    const { queryDb, cleanupExpiredApprovals } = require('./controller');
    await cleanupExpiredApprovals();

    const statusRows = await queryDb(
      `SELECT status, count(*)::integer as count 
       FROM jarvis_approval_requests 
       GROUP BY status;`
    );
    
    const stats = {
      pending: 0,
      approved: 0,
      rejected: 0,
      cancelled: 0,
      expired: 0,
      executed: 0,
      failed: 0
    };
    
    statusRows.forEach(r => {
      if (r.status in stats) {
        stats[r.status] = r.count;
      }
    });
    
    const riskRows = await queryDb(
      `SELECT risk_level, count(*)::integer as count 
       FROM jarvis_approval_requests 
       GROUP BY risk_level;`
    );
    
    const riskBreakdown = {
      low: 0,
      medium: 0,
      high: 0
    };
    
    riskRows.forEach(r => {
      const key = (r.risk_level || 'medium').toLowerCase();
      if (key in riskBreakdown) {
        riskBreakdown[key] = r.count;
      }
    });

    return res.status(200).json({
      status_counts: stats,
      risk_breakdown: riskBreakdown
    });
  } catch (err) {
    console.error('[Approval Stats API Error]', err.message);
    return res.status(500).json({ error: 'Internal server error fetching approval stats' });
  }
});

// GET /api/jarvis/connectors
router.get('/connectors', authenticateAdminSession, async (req, res) => {
  try {
    const { listConnectorsStatus } = require('./connectors-summary');
    const connectors = await listConnectorsStatus();
    return res.status(200).json(connectors);
  } catch (err) {
    console.error('[Connectors API Error]', err.message);
    return res.status(500).json({ error: 'Internal server error fetching connectors status' });
  }
});

// GET /api/jarvis/projects
router.get('/projects', authenticateAdminSession, async (req, res) => {
  try {
    const { queryDb } = require('./controller');
    const rows = await queryDb("SELECT * FROM jarvis_projects ORDER BY created_at DESC;");
    return res.status(200).json(rows);
  } catch (err) {
    console.error('[Projects API Error]', err.message);
    return res.status(500).json({ error: 'Internal server error fetching projects' });
  }
});

// GET /api/jarvis/mobile-uploads
router.get('/mobile-uploads', authenticateAdminSession, async (req, res) => {
  try {
    const { queryDb } = require('./controller');
    const rows = await queryDb("SELECT * FROM jarvis_mobile_uploads ORDER BY created_at DESC LIMIT 50;");
    return res.status(200).json(rows);
  } catch (err) {
    console.error('[Mobile Uploads API Error]', err.message);
    return res.status(500).json({ error: 'Internal server error fetching mobile uploads' });
  }
});

// GET /api/jarvis/priorities
router.get('/priorities', authenticateAdminSession, async (req, res) => {
  try {
    const { getPriorityIntelligence } = require('./intelligence');
    const intel = await getPriorityIntelligence();
    return res.status(200).json(intel);
  } catch (err) {
    console.error('[Priorities API Error]', err.message);
    return res.status(500).json({ error: 'Internal server error fetching priorities' });
  }
});

const workSessions = require('./work-sessions');

// GET /api/jarvis/work-sessions
router.get('/work-sessions', authenticateAdminSession, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '10', 10);
    const sessions = await workSessions.listWorkSessions(limit);
    return res.status(200).json(sessions);
  } catch (err) {
    console.error('[WorkSessions API Error]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/jarvis/work-sessions/latest
router.get('/work-sessions/latest', authenticateAdminSession, async (req, res) => {
  try {
    const session = await workSessions.getActiveSession();
    return res.status(200).json(session || { message: 'No active session' });
  } catch (err) {
    console.error('[WorkSessions API Error]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/jarvis/work-sessions/project/:project_slug
router.get('/work-sessions/project/:project_slug', authenticateAdminSession, async (req, res) => {
  try {
    const slug = req.params.project_slug;
    const sessions = await workSessions.getProjectSessions(slug);
    return res.status(200).json(sessions);
  } catch (err) {
    console.error('[WorkSessions API Error]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/jarvis/work-sessions/start
router.post('/work-sessions/start', authenticateAdminSession, async (req, res) => {
  try {
    const { project_slug, source, text_content } = req.body;
    const session = await workSessions.startWorkSession(project_slug, source || 'dashboard', text_content);
    return res.status(201).json(session);
  } catch (err) {
    console.error('[WorkSessions API Error]', err.message);
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/jarvis/work-sessions/update
router.post('/work-sessions/update', authenticateAdminSession, async (req, res) => {
  try {
    const { project_slug, summary, source } = req.body;
    const session = await workSessions.updateWorkSession(project_slug, summary, source || 'dashboard');
    return res.status(200).json(session);
  } catch (err) {
    console.error('[WorkSessions API Error]', err.message);
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/jarvis/work-sessions/done
router.post('/work-sessions/done', authenticateAdminSession, async (req, res) => {
  try {
    const { project_slug, summary, source } = req.body;
    const session = await workSessions.doneWorkSession(project_slug, summary, source || 'dashboard');
    return res.status(200).json(session);
  } catch (err) {
    console.error('[WorkSessions API Error]', err.message);
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/jarvis/handoff/ingest
router.post('/handoff/ingest', authenticateAdminSession, async (req, res) => {
  try {
    const session = await workSessions.ingestHandoffFile();
    return res.status(200).json({ success: true, message: 'Handoff file ingested successfully', session });
  } catch (err) {
    console.error('[Handoff Ingest API Error]', err.message);
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
