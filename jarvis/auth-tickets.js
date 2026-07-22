/**
 * Single-Use Cryptographic Auth Ticket Store for Jarvis
 * Handles dashboard and OAuth ticket issuance, exchange validation, and single-use invalidation.
 */

const crypto = require('crypto');
const { queryDb } = require('./db');

// In-memory fallback map for environments without active DB
const memoryTicketStore = new Map();

/**
 * Create a single-use authorization ticket.
 * @param {string} purpose (e.g. 'dashboard_access', 'google_oauth_connect')
 * @param {Object} metadata
 * @param {number} ttlSeconds Default: 300 (5 minutes)
 * @returns {Promise<string>} Cryptographic ticket string
 */
async function createAuthTicket(purpose, metadata = {}, ttlSeconds = 300) {
  const ticketId = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  try {
    const rows = await queryDb(
      `INSERT INTO jarvis_auth_tickets (ticket_id, purpose, metadata, expires_at, used)
       VALUES ($1, $2, $3, $4, FALSE)
       RETURNING ticket_id;`,
      [ticketId, purpose, JSON.stringify(metadata), expiresAt.toISOString()]
    );
    if (rows && rows.length > 0) {
      return ticketId;
    }
  } catch (err) {
    console.warn('[AuthTickets] Database ticket creation failed, using memory store fallback:', err.message);
  }

  // Fallback to memory store if DB query fails or DB unavailable
  memoryTicketStore.set(ticketId, {
    purpose,
    metadata,
    expiresAt,
    used: false
  });
  return ticketId;
}

/**
 * Atomically validate and consume a single-use authorization ticket.
 * Replay calls will return valid = false.
 * @param {string} ticketId
 * @param {string} expectedPurpose
 * @returns {Promise<{ valid: boolean, metadata?: Object, reason?: string }>}
 */
async function validateAndConsumeTicket(ticketId, expectedPurpose) {
  if (!ticketId || typeof ticketId !== 'string') {
    return { valid: false, reason: 'Invalid ticket format' };
  }

  const now = new Date();

  // 1. Try DB validation
  try {
    const rows = await queryDb(
      `SELECT ticket_id, purpose, metadata, expires_at, used
       FROM jarvis_auth_tickets
       WHERE ticket_id = $1;`,
      [ticketId]
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

      // Mark as used (atomic update)
      const updateResult = await queryDb(
        `UPDATE jarvis_auth_tickets
         SET used = TRUE
         WHERE ticket_id = $1 AND used = FALSE
         RETURNING ticket_id;`,
        [ticketId]
      );

      if (!updateResult || updateResult.length === 0) {
        return { valid: false, reason: 'Ticket was concurrently consumed (replay rejected)' };
      }

      const meta = typeof ticket.metadata === 'string' ? JSON.parse(ticket.metadata) : ticket.metadata;
      return { valid: true, metadata: meta };
    }
  } catch (err) {
    console.warn('[AuthTickets] DB ticket lookup failed, checking memory fallback:', err.message);
  }

  // 2. Memory fallback check
  const memTicket = memoryTicketStore.get(ticketId);
  if (!memTicket) {
    return { valid: false, reason: 'Ticket not found' };
  }

  if (memTicket.used) {
    return { valid: false, reason: 'Ticket has already been used (replay rejected)' };
  }
  if (memTicket.expiresAt < now) {
    memoryTicketStore.delete(ticketId);
    return { valid: false, reason: 'Ticket has expired' };
  }
  if (expectedPurpose && memTicket.purpose !== expectedPurpose) {
    return { valid: false, reason: `Purpose mismatch` };
  }

  memTicket.used = true;
  memoryTicketStore.set(ticketId, memTicket);
  return { valid: true, metadata: memTicket.metadata };
}

/**
 * Purge expired tickets from database and memory.
 */
async function cleanupExpiredTickets() {
  const now = new Date().toISOString();
  try {
    await queryDb(`DELETE FROM jarvis_auth_tickets WHERE expires_at < $1 OR used = TRUE;`, [now]);
  } catch (err) {
    // Ignore error in fallback
  }

  const nowMs = Date.now();
  for (const [id, ticket] of memoryTicketStore.entries()) {
    if (ticket.expiresAt.getTime() < nowMs || ticket.used) {
      memoryTicketStore.delete(id);
    }
  }
}

module.exports = {
  createAuthTicket,
  validateAndConsumeTicket,
  cleanupExpiredTickets
};
