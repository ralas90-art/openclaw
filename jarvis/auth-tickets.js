/**
 * Single-Use Cryptographic Auth Ticket & Session Store for Jarvis
 * Handles dashboard access tickets, Google OAuth connect tickets, single-use redemption,
 * session token issuance, timing-safe string comparison, and rate-limiting guards.
 */

const crypto = require('crypto');
const { queryDb } = require('./db');

// In-memory fallbacks for non-production environments when DB is unconfigured
const memoryTicketStore = new Map();
const memorySessionStore = new Map();
const rateLimitMap = new Map();

function hashToken(token) {
  if (!token || typeof token !== 'string') return '';
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Buffer-length guarded timing-safe string comparison.
 */
function safeTimingEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * In-memory rate limiting check for ticket endpoints.
 * Returns true if allowed, false if rate limited.
 */
function checkTicketRateLimit(identifier, maxRequests = 20, windowMs = 60000) {
  const now = Date.now();
  const entry = rateLimitMap.get(identifier) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 1;
    entry.resetAt = now + windowMs;
  } else {
    entry.count += 1;
  }
  rateLimitMap.set(identifier, entry);
  return entry.count <= maxRequests;
}

/**
 * Issue a short-lived single-use authorization ticket.
 * @param {string} purpose ('dashboard_access', 'google_oauth_connect', 'oauth_state')
 * @param {Object} metadata
 * @param {number} ttlSeconds Default: 300 (5 minutes)
 */
async function createAuthTicket(purpose, metadata = {}, ttlSeconds = 300) {
  const ticketId = crypto.randomBytes(32).toString('hex');
  const ticketHash = hashToken(ticketId);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  if (process.env.DATABASE_URL) {
    try {
      await queryDb(
        `INSERT INTO jarvis_auth_tickets (ticket_id, ticket_hash, purpose, metadata, expires_at, used)
         VALUES ($1, $2, $3, $4, $5, FALSE);`,
        [ticketHash, ticketHash, purpose, JSON.stringify(metadata), expiresAt.toISOString()]
      );
      return ticketId;
    } catch (err) {
      console.error('[AuthTickets] Failed to insert auth ticket in DB:', err.message);
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Database error during ticket creation.');
      }
    }
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL required for ticket creation in production.');
  }

  // Memory fallback for non-prod local testing
  memoryTicketStore.set(ticketHash, {
    purpose,
    metadata,
    expiresAt,
    used: false
  });
  return ticketId;
}

/**
 * Atomically validate and consume a single-use authorization ticket.
 */
async function validateAndConsumeTicket(ticketId, expectedPurpose) {
  if (!ticketId || typeof ticketId !== 'string') {
    return { valid: false, reason: 'Invalid ticket format' };
  }

  const ticketHash = hashToken(ticketId);
  const now = new Date();

  // 1. Try DB validation & atomic update
  if (process.env.DATABASE_URL) {
    try {
      const rows = await queryDb(
        `SELECT ticket_id, purpose, metadata, expires_at, used
         FROM jarvis_auth_tickets
         WHERE ticket_hash = $1 OR ticket_id = $1;`,
        [ticketHash]
      );

      if (rows && rows.length > 0) {
        const ticket = rows[0];
        const expiresAt = new Date(ticket.expires_at);

        if (ticket.used) {
          return { valid: false, reason: 'Ticket has already been used (replay rejected)' };
        }
        if (expiresAt < now) {
          return { valid: false, reason: 'Ticket has expired' };
        }
        if (expectedPurpose && ticket.purpose !== expectedPurpose) {
          return { valid: false, reason: `Purpose mismatch. Expected '${expectedPurpose}', got '${ticket.purpose}'` };
        }

        // Mark used atomically
        const updateRows = await queryDb(
          `UPDATE jarvis_auth_tickets
           SET used = TRUE
           WHERE (ticket_hash = $1 OR ticket_id = $1) AND used = FALSE
           RETURNING ticket_id;`,
          [ticketHash]
        );

        if (!updateRows || updateRows.length === 0) {
          return { valid: false, reason: 'Ticket was concurrently consumed (replay rejected)' };
        }

        const meta = typeof ticket.metadata === 'string' ? JSON.parse(ticket.metadata) : ticket.metadata;
        return { valid: true, metadata: meta };
      }
    } catch (err) {
      console.error('[AuthTickets] DB error during ticket validation:', err.message);
      if (process.env.NODE_ENV === 'production') {
        return { valid: false, reason: 'Database error during ticket validation' };
      }
    }
  }

  if (process.env.NODE_ENV === 'production') {
    return { valid: false, reason: 'DATABASE_URL required for ticket validation in production' };
  }

  // Memory fallback for non-prod local testing
  const memTicket = memoryTicketStore.get(ticketHash) || memoryTicketStore.get(ticketId);
  if (!memTicket) {
    return { valid: false, reason: 'Ticket not found' };
  }
  if (memTicket.used) {
    return { valid: false, reason: 'Ticket has already been used (replay rejected)' };
  }
  if (memTicket.expiresAt < now) {
    memoryTicketStore.delete(ticketHash);
    memoryTicketStore.delete(ticketId);
    return { valid: false, reason: 'Ticket has expired' };
  }
  if (expectedPurpose && memTicket.purpose !== expectedPurpose) {
    return { valid: false, reason: 'Purpose mismatch' };
  }

  memTicket.used = true;
  memoryTicketStore.set(ticketHash, memTicket);
  return { valid: true, metadata: memTicket.metadata };
}

/**
 * Issue a short-lived session token (e.g. 1 hour TTL) upon valid ticket exchange.
 */
async function createSessionToken(metadata = {}, ttlSeconds = 3600) {
  const sessionToken = 'srv_sess_' + crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(sessionToken);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  if (process.env.DATABASE_URL) {
    try {
      await queryDb(
        `INSERT INTO jarvis_sessions (session_token, token_hash, metadata, expires_at)
         VALUES ($1, $2, $3, $4);`,
        [tokenHash, tokenHash, JSON.stringify(metadata), expiresAt.toISOString()]
      );
      return sessionToken;
    } catch (err) {
      console.error('[AuthTickets] DB error creating session token:', err.message);
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Database error creating session token.');
      }
    }
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL required for session creation in production.');
  }

  memorySessionStore.set(tokenHash, { metadata, expiresAt });
  return sessionToken;
}

/**
 * Validate an active session token.
 */
async function validateSessionToken(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'Invalid token format' };
  }

  const tokenHash = hashToken(token);
  const now = new Date();

  if (process.env.DATABASE_URL) {
    try {
      const rows = await queryDb(
        `SELECT session_token, metadata, expires_at
         FROM jarvis_sessions
         WHERE token_hash = $1 OR session_token = $1;`,
        [tokenHash]
      );
      if (rows && rows.length > 0) {
        const session = rows[0];
        const expiresAt = new Date(session.expires_at);
        if (expiresAt < now) {
          return { valid: false, reason: 'Session expired' };
        }
        const meta = typeof session.metadata === 'string' ? JSON.parse(session.metadata) : session.metadata;
        return { valid: true, metadata: meta };
      }
    } catch (err) {
      console.error('[AuthTickets] DB error validating session token:', err.message);
    }
  }

  const memSession = memorySessionStore.get(tokenHash) || memorySessionStore.get(token);
  if (memSession) {
    if (memSession.expiresAt < now) {
      memorySessionStore.delete(tokenHash);
      memorySessionStore.delete(token);
      return { valid: false, reason: 'Session expired' };
    }
    return { valid: true, metadata: memSession.metadata };
  }

  return { valid: false, reason: 'Session not found or invalid' };
}

module.exports = {
  safeTimingEqual,
  checkTicketRateLimit,
  createAuthTicket,
  validateAndConsumeTicket,
  createSessionToken,
  validateSessionToken
};
