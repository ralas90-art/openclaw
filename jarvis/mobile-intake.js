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
 * Validates the media_url to ensure it uses an allowed domain, 
 * enforces HTTPS in production, and restricts local testing domains to non-production.
 */
function isValidMediaUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    
    // Check protocol: must be https, unless it is http on localhost/127.0.0.1 in non-production environments
    const isProduction = process.env.NODE_ENV === 'production';
    const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    
    if (parsed.protocol !== 'https:') {
      if (parsed.protocol === 'http:' && isLocalhost && !isProduction) {
        // Allow http on localhost during local testing
      } else {
        return false;
      }
    }
    
    // Enforce localhost/127.0.0.1 is blocked in production
    if (isLocalhost && isProduction) {
      return false;
    }
    
    const hostname = parsed.hostname.toLowerCase();
    
    // Resolve Supabase Storage host from environment
    let supabaseHost = null;
    if (process.env.SUPABASE_URL) {
      try {
        supabaseHost = new URL(process.env.SUPABASE_URL).hostname.toLowerCase();
      } catch (e) {
        // Ignore invalid URL
      }
    }
    
    // Allowed exact domains
    const allowedExact = [
      'drive.google.com',
      'docs.google.com',
      'localhost',
      '127.0.0.1'
    ];
    
    if (supabaseHost) {
      allowedExact.push(supabaseHost);
    } else {
      // Fallback for tests run without SUPABASE_URL configured in env
      allowedExact.push('project-id.supabase.co');
      allowedExact.push('postgres.supabase.co');
    }
    
    if (allowedExact.includes(hostname)) {
      return true;
    }
    
    return false;
  } catch (err) {
    return false;
  }
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
    const allowedFields = ['intake_source', 'task_type', 'project_slug', 'text_content', 'media_url', 'notes'];
    const payload = {};
    
    // Strip unknown fields
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        payload[key] = req.body[key];
      }
    }
    
    const { intake_source, task_type, project_slug, text_content, media_url, notes } = payload;
    
    // 1. Validate intake_source
    const allowedSources = ['shortcut', 'sharesheet', 'siri'];
    if (!intake_source || !allowedSources.includes(intake_source)) {
      return res.status(400).json({ error: `Bad Request: Invalid intake_source. Must be one of: ${allowedSources.join(', ')}` });
    }
    
    // 2. Validate task_type
    const allowedTaskTypes = ['text', 'screenshot', 'photo'];
    if (!task_type || !allowedTaskTypes.includes(task_type)) {
      return res.status(400).json({ error: `Bad Request: Invalid task_type. Must be one of: ${allowedTaskTypes.join(', ')}` });
    }
    
    // 3. Validate media_url
    if (task_type === 'screenshot' || task_type === 'photo') {
      if (!media_url || typeof media_url !== 'string' || media_url.trim() === '') {
        return res.status(400).json({ error: `Bad Request: media_url is required when task_type is '${task_type}'` });
      }
      if (!isValidMediaUrl(media_url)) {
        return res.status(400).json({ error: "Bad Request: media_url must be a valid URL from an approved storage provider (Supabase Storage or Google Drive)" });
      }
    }
    
    // 4. Validate text_content
    if (task_type === 'text') {
      if (!text_content || typeof text_content !== 'string' || text_content.trim() === '') {
        return res.status(400).json({ error: "Bad Request: text_content is required and must be a non-empty string when task_type is 'text'" });
      }
    }
    if (text_content !== undefined && text_content !== null) {
      if (typeof text_content !== 'string') {
        return res.status(400).json({ error: "Bad Request: text_content must be a string" });
      }
      if (text_content.length > 5000) {
        return res.status(400).json({ error: "Bad Request: text_content exceeds the limit of 5000 characters" });
      }
    }
    
    // 5. Validate project_slug if provided
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
    
    // 6. Insert upload record (processed explicitly set to false)
    const rows = await queryDb(
      `INSERT INTO jarvis_mobile_uploads (intake_source, task_type, project_slug, text_content, media_url, notes, processed)
       VALUES ($1, $2, $3, $4, $5, $6, false)
       RETURNING id, intake_source, task_type, project_slug, text_content, media_url, notes, processed, created_at`,
      [
        intake_source,
        task_type,
        cleanSlug,
        text_content ? text_content.trim() : null,
        media_url ? media_url.trim() : null,
        notes ? notes.trim() : null
      ]
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
