/**
 * Jarvis Mobile Intake Module
 * Phase 3A: Secure Mobile Text Intake
 */

const crypto = require('crypto');
const { Client } = require('pg');

const DB_URL = process.env.DATABASE_URL;
const rateLimitCache = new Map(); // device_id -> { count, windowStart }

/**
 * Direct PG Database Query helper
 */
async function queryDb(sqlText, params = []) {
  if (!DB_URL) {
    throw new Error('DATABASE_URL is not configured');
  }
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const res = await client.query(sqlText, params);
    return res.rows;
  } finally {
    await client.end();
  }
}

/**
 * Checks in-memory rate limiting by device ID
 */
function checkRateLimit(deviceId) {
  const now = Date.now();
  const limit = 10;
  const windowMs = 60 * 1000; // 1 minute window
  
  if (!rateLimitCache.has(deviceId)) {
    rateLimitCache.set(deviceId, { count: 1, windowStart: now });
    return true;
  }
  
  const entry = rateLimitCache.get(deviceId);
  if (now - entry.windowStart > windowMs) {
    entry.count = 1;
    entry.windowStart = now;
    return true;
  }
  
  if (entry.count >= limit) {
    return false;
  }
  
  entry.count++;
  return true;
}

/**
 * Mobile Token Authorization Middleware
 */
async function authenticateMobileToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or malformed token' });
  }
  
  const token = authHeader.substring(7).trim();
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Empty token' });
  }
  
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  
  try {
    const tokens = await queryDb(
      `SELECT * FROM jarvis_mobile_tokens 
       WHERE token_hash = $1 AND active = true AND (expires_at IS NULL OR expires_at > NOW())`,
      [tokenHash]
    );
    
    if (tokens.length === 0) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
    }
    
    const tokenRecord = tokens[0];
    const deviceId = tokenRecord.device_id || 'unknown';
    
    // Rate limiter check
    if (!checkRateLimit(deviceId)) {
      return res.status(429).json({ error: 'Too Many Requests: Rate limit exceeded (max 10 requests per minute)' });
    }
    
    // Update last used timestamp asynchronously
    queryDb(
      'UPDATE jarvis_mobile_tokens SET last_used_at = NOW() WHERE id = $1',
      [tokenRecord.id]
    ).catch(err => console.error('[MobileIntake] Failed to update last_used_at:', err.message));
    
    req.mobileToken = tokenRecord;
    next();
  } catch (err) {
    console.error('[MobileIntake Auth Error]', err.message);
    return res.status(500).json({ error: 'Internal server authorization error' });
  }
}

/**
 * Mobile Intake request handler
 */
async function handleMobileIntake(req, res) {
  try {
    const allowedFields = ['intake_source', 'task_type', 'project_slug', 'text_content', 'notes'];
    const payload = {};
    
    // Strip unknown fields
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        payload[key] = req.body[key];
      }
    }
    
    const { intake_source, task_type, project_slug, text_content, notes } = payload;
    
    // 1. Validate intake_source
    const allowedSources = ['shortcut', 'sharesheet', 'siri'];
    if (!intake_source || !allowedSources.includes(intake_source)) {
      return res.status(400).json({ error: `Bad Request: Invalid intake_source. Must be one of: ${allowedSources.join(', ')}` });
    }
    
    // 2. Validate task_type (Phase 3A strictly limits to 'text')
    if (!task_type) {
      return res.status(400).json({ error: "Bad Request: Missing task_type" });
    }
    if (task_type !== 'text') {
      return res.status(400).json({ error: "Bad Request: task_type must be strictly 'text' in Phase 3A" });
    }
    
    // 3. Validate text_content
    if (!text_content || typeof text_content !== 'string' || text_content.trim() === '') {
      return res.status(400).json({ error: "Bad Request: text_content is required and must be a non-empty string" });
    }
    if (text_content.length > 5000) {
      return res.status(400).json({ error: "Bad Request: text_content exceeds the limit of 5000 characters" });
    }
    
    // 4. Validate project_slug if provided
    let cleanSlug = null;
    if (project_slug) {
      cleanSlug = project_slug.trim().toLowerCase();
      const projCheck = await queryDb(
        "SELECT slug FROM jarvis_projects WHERE slug = $1 AND status = 'active'",
        [cleanSlug]
      );
      if (projCheck.length === 0) {
        return res.status(400).json({ error: `Bad Request: Invalid or inactive project slug: '${project_slug}'` });
      }
    }
    
    // 5. Insert upload record (processed explicitly set to false)
    const rows = await queryDb(
      `INSERT INTO jarvis_mobile_uploads (intake_source, task_type, project_slug, text_content, notes, processed)
       VALUES ($1, $2, $3, $4, $5, false)
       RETURNING id, intake_source, task_type, project_slug, text_content, notes, processed, created_at`,
      [intake_source, task_type, cleanSlug, text_content.trim(), notes ? notes.trim() : null]
    );
    
    const record = rows[0];
    return res.status(201).json({
      success: true,
      message: 'Mobile intake recorded successfully',
      data: record
    });
  } catch (err) {
    console.error('[MobileIntake Error]', err.message);
    return res.status(500).json({ error: 'Internal server error processing mobile intake' });
  }
}

module.exports = {
  authenticateMobileToken,
  handleMobileIntake
};
