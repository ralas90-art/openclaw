/**
 * OpenClaw Runtime Approvals Manager
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getWorkspaceRoot } = require('./bot-loader');
const { logEvent } = require('./runtime-logger');

function getApprovalsFilePath() {
  const workspaceRoot = getWorkspaceRoot();
  return path.join(workspaceRoot, 'openclaw', 'runtime', 'logs', 'runtime-approvals.json');
}

/**
 * Loads all approval records from file safely.
 * @returns {object[]}
 */
function _loadApprovals() {
  try {
    const filePath = getApprovalsFilePath();
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content || '[]');
  } catch (err) {
    console.warn(`[runtime-approvals] Failed to load approvals: ${err.message}`);
    return [];
  }
}

/**
 * Saves all approval records to file safely.
 * @param {object[]} approvals
 */
function _saveApprovals(approvals) {
  try {
    const filePath = getApprovalsFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(approvals, null, 2), 'utf8');
  } catch (err) {
    console.warn(`[runtime-approvals] Failed to save approvals: ${err.message}`);
  }
}

/**
 * Creates a unique filesystem and Telegram-safe approval ID.
 * Format: ap_YYYYMMDD_HHMMSS_<shortRandomId>
 * @returns {string}
 */
function _generateApprovalId() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const timestamp = `${year}${month}${day}_${hours}${minutes}${seconds}`;
  const shortRandomId = crypto.randomBytes(3).toString('hex');
  return `ap_${timestamp}_${shortRandomId}`;
}

/**
 * Creates a pending approval record.
 * @param {string|number} senderChatId
 * @param {string} command
 * @param {string} commandTier
 * @param {string|null} botSlug
 * @param {string|null} presetId
 * @param {string} inputPreview
 * @param {object} safePayload
 * @returns {object}
 */
function createApproval(senderChatId, command, commandTier, botSlug, presetId, inputPreview, safePayload) {
  const approvals = _loadApprovals();
  const approvalId = _generateApprovalId();
  
  const now = new Date();
  const ttlMinutes = parseInt(process.env.OPENCLAW_APPROVAL_TTL_MINUTES, 10) || 60;
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60000);

  const chatIdStr = senderChatId ? String(senderChatId).trim() : 'unknown';
  const requestedByChatIdHash = crypto.createHash('sha256').update(chatIdStr).digest('hex').substring(0, 16);

  const record = {
    approvalId,
    status: 'pending',
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    requestedByChatIdHash,
    command,
    commandTier,
    botSlug: botSlug || null,
    presetId: presetId || null,
    inputPreview: inputPreview || '',
    safePayload: safePayload || {},
    resultJobId: null,
    resultFilename: null,
    driveLink: null,
    approvedAt: null,
    rejectedAt: null,
    executedAt: null,
    safeMessage: null
  };

  approvals.push(record);
  _saveApprovals(approvals);

  logEvent({
    event: 'approval_created',
    approvalId,
    command,
    commandTier,
    botSlug: botSlug || undefined,
    presetId: presetId || undefined,
    status: 'pending'
  });

  return record;
}

/**
 * Retrieves an approval record by ID, checking for expiration.
 * @param {string} approvalId
 * @returns {object|null}
 */
function getApproval(approvalId) {
  if (!approvalId || typeof approvalId !== 'string') return null;
  // Safety check: validate approval ID format
  const idPattern = /^ap_\d{8}_\d{6}_[a-f0-9]{6}$/;
  if (!idPattern.test(approvalId)) {
    return null;
  }

  const approvals = _loadApprovals();
  const index = approvals.findIndex(a => a.approvalId === approvalId);
  if (index === -1) return null;

  const record = approvals[index];
  
  // Expiration check
  if (record.status === 'pending') {
    const now = new Date();
    const expiresAt = new Date(record.expiresAt);
    if (now > expiresAt) {
      record.status = 'expired';
      _saveApprovals(approvals);

      logEvent({
        event: 'approval_expired',
        approvalId: record.approvalId,
        command: record.command,
        commandTier: record.commandTier,
        botSlug: record.botSlug || undefined,
        presetId: record.presetId || undefined,
        status: 'expired'
      });
    }
  }

  return record;
}

/**
 * Lists pending/recent approvals up to a limit, sorted newest first.
 * @param {number} limit
 * @returns {object[]}
 */
function listApprovals(limit = 5) {
  const approvals = _loadApprovals();
  // Automatically trigger expiration check on all pending approvals
  const now = new Date();
  let modified = false;

  const processed = approvals.map(record => {
    if (record.status === 'pending') {
      const expiresAt = new Date(record.expiresAt);
      if (now > expiresAt) {
        record.status = 'expired';
        modified = true;
        
        logEvent({
          event: 'approval_expired',
          approvalId: record.approvalId,
          command: record.command,
          commandTier: record.commandTier,
          botSlug: record.botSlug || undefined,
          presetId: record.presetId || undefined,
          status: 'expired'
        });
      }
    }
    return record;
  });

  if (modified) {
    _saveApprovals(processed);
  }

  // Sort newest first
  return processed
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

/**
 * Transition approval status to approved.
 * @param {string} approvalId
 * @returns {object|null}
 */
function transitionToApproved(approvalId) {
  const record = getApproval(approvalId);
  if (!record) return null;

  if (record.status !== 'pending') {
    return record;
  }

  const approvals = _loadApprovals();
  const index = approvals.findIndex(a => a.approvalId === approvalId);
  if (index !== -1) {
    approvals[index].status = 'approved';
    approvals[index].approvedAt = new Date().toISOString();
    _saveApprovals(approvals);

    logEvent({
      event: 'approval_approved',
      approvalId: record.approvalId,
      command: record.command,
      commandTier: record.commandTier,
      botSlug: record.botSlug || undefined,
      presetId: record.presetId || undefined,
      status: 'approved'
    });

    return approvals[index];
  }
  return null;
}

/**
 * Transition approval status to rejected.
 * @param {string} approvalId
 * @returns {object|null}
 */
function rejectApproval(approvalId) {
  const record = getApproval(approvalId);
  if (!record) return null;

  if (record.status !== 'pending') {
    return record;
  }

  const approvals = _loadApprovals();
  const index = approvals.findIndex(a => a.approvalId === approvalId);
  if (index !== -1) {
    approvals[index].status = 'rejected';
    approvals[index].rejectedAt = new Date().toISOString();
    _saveApprovals(approvals);

    logEvent({
      event: 'approval_rejected',
      approvalId: record.approvalId,
      command: record.command,
      commandTier: record.commandTier,
      botSlug: record.botSlug || undefined,
      presetId: record.presetId || undefined,
      status: 'rejected'
    });

    return approvals[index];
  }
  return null;
}

/**
 * Transition approval status to executed.
 * @param {string} approvalId
 * @param {string|null} jobId
 * @param {string|null} filename
 * @param {string|null} driveLink
 * @param {string|null} safeMessage
 * @returns {object|null}
 */
function transitionToExecuted(approvalId, jobId, filename, driveLink, safeMessage) {
  const record = getApproval(approvalId);
  if (!record) return null;

  const approvals = _loadApprovals();
  const index = approvals.findIndex(a => a.approvalId === approvalId);
  if (index !== -1) {
    approvals[index].status = 'executed';
    approvals[index].executedAt = new Date().toISOString();
    approvals[index].resultJobId = jobId || null;
    approvals[index].resultFilename = filename || null;
    approvals[index].driveLink = driveLink || null;
    approvals[index].safeMessage = safeMessage || null;
    _saveApprovals(approvals);

    logEvent({
      event: 'approval_executed',
      approvalId: record.approvalId,
      command: record.command,
      commandTier: record.commandTier,
      botSlug: record.botSlug || undefined,
      presetId: record.presetId || undefined,
      status: 'executed',
      jobId: jobId || undefined,
      filename: filename || undefined,
      driveLink: driveLink || undefined
    });

    return approvals[index];
  }
  return null;
}

/**
 * Transition approval status to execution_failed.
 * @param {string} approvalId
 * @param {string} errorMsg
 * @returns {object|null}
 */
function transitionToExecutionFailed(approvalId, errorMsg) {
  const record = getApproval(approvalId);
  if (!record) return null;

  const approvals = _loadApprovals();
  const index = approvals.findIndex(a => a.approvalId === approvalId);
  if (index !== -1) {
    approvals[index].status = 'execution_failed';
    approvals[index].executedAt = new Date().toISOString();
    approvals[index].safeMessage = `Execution failed: ${errorMsg}`;
    _saveApprovals(approvals);

    logEvent({
      event: 'approval_execution_failed',
      approvalId: record.approvalId,
      command: record.command,
      commandTier: record.commandTier,
      botSlug: record.botSlug || undefined,
      presetId: record.presetId || undefined,
      status: 'execution_failed',
      error: errorMsg
    });

    return approvals[index];
  }
  return null;
}


/**
 * Safely sanitizes a search query string.
 * Caps length to 50 chars, allows only alphanumeric, space, hyphens, and underscores.
 * @param {string} query
 * @returns {string}
 */
function sanitizeApprovalSearchQuery(query) {
  if (typeof query !== 'string') return '';
  const clean = query.trim().substring(0, 50);
  return clean.replace(/[^a-zA-Z0-9\s_-]/g, '');
}

/**
 * Returns recent approval history, sorted newest first.
 * @param {number} limit
 * @returns {object[]}
 */
function getApprovalHistory(limit = 10) {
  const approvals = _loadApprovals();
  const now = new Date();
  let modified = false;
  const processed = approvals.map(record => {
    if (record.status === 'pending') {
      const expiresAt = new Date(record.expiresAt);
      if (now > expiresAt) {
        record.status = 'expired';
        modified = true;
        logEvent({
          event: 'approval_expired',
          approvalId: record.approvalId,
          command: record.command,
          commandTier: record.commandTier,
          botSlug: record.botSlug || undefined,
          presetId: record.presetId || undefined,
          status: 'expired'
        });
      }
    }
    return record;
  });
  if (modified) {
    _saveApprovals(processed);
  }
  return processed
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

/**
 * Searches approval records case-insensitively using substring search.
 * @param {string} rawQuery
 * @param {number} limit
 * @returns {object[]}
 */
function searchApprovals(rawQuery, limit = 5) {
  const query = sanitizeApprovalSearchQuery(rawQuery);
  if (!query) return [];

  const approvals = getApprovalHistory(9999);
  const lowerQuery = query.toLowerCase();

  const results = approvals.filter(a => {
    const fieldsToSearch = [
      a.approvalId,
      a.status,
      a.command,
      a.commandTier,
      a.botSlug,
      a.presetId,
      a.inputPreview,
      a.resultJobId,
      a.resultFilename,
      a.safeMessage
    ];
    return fieldsToSearch.some(field => field && typeof field === 'string' && field.toLowerCase().includes(lowerQuery));
  });

  return results.slice(0, limit);
}

/**
 * Lists approval records matching a specific status.
 * @param {string} status
 * @param {number} limit
 * @returns {object[]}
 */
function getApprovalsByStatus(status, limit = 10) {
  if (typeof status !== 'string') return [];
  const cleanStatus = status.trim().toLowerCase();
  const allowed = ['pending', 'approved', 'rejected', 'expired', 'executed', 'failed'];
  if (!allowed.includes(cleanStatus)) {
    return [];
  }

  const approvals = getApprovalHistory(9999);
  const results = approvals.filter(a => {
    const s = a.status.toLowerCase();
    if (cleanStatus === 'failed') {
      return s === 'failed' || s === 'execution_failed';
    }
    return s === cleanStatus;
  });

  return results.slice(0, limit);
}

/**
 * Admin maintenance command logic to find pending approvals past expiration time and transition them to expired.
 * @returns {number} The count of newly expired approvals.
 */
function cleanupExpiredApprovals() {
  const approvals = _loadApprovals();
  const now = new Date();
  let expiredCount = 0;
  
  const processed = approvals.map(record => {
    if (record.status === 'pending') {
      const expiresAt = new Date(record.expiresAt);
      if (now > expiresAt) {
        record.status = 'expired';
        expiredCount++;
        logEvent({
          event: 'approval_expired',
          approvalId: record.approvalId,
          command: record.command,
          commandTier: record.commandTier,
          botSlug: record.botSlug || undefined,
          presetId: record.presetId || undefined,
          status: 'expired'
        });
      }
    }
    return record;
  });

  if (expiredCount > 0) {
    _saveApprovals(processed);
  }
  return expiredCount;
}

/**
 * Formats a single approval record for Telegram response.
 * Ensures no absolute paths, secrets, or internal payloads are exposed.
 * @param {object} a Approval record
 * @returns {string} Formatted Telegram message section
 */
function summarizeApprovalForTelegram(a) {
  if (!a) return '';
  const lines = [];
  lines.push(`• *Approval ID:* \`${a.approvalId}\` [${a.status.toUpperCase()}]`);
  
  let cmdLine = `  *Command:* \`${a.command}\``;
  if (a.botSlug) cmdLine += ` | Bot: \`${a.botSlug}\``;
  if (a.presetId) cmdLine += ` | Preset: \`${a.presetId}\``;
  lines.push(cmdLine);

  lines.push(`  *Created:* ${a.createdAt}`);

  if (a.status === 'executed' && a.executedAt) {
    lines.push(`  *Executed:* ${a.executedAt}`);
  } else if (a.status === 'rejected' && a.rejectedAt) {
    lines.push(`  *Rejected:* ${a.rejectedAt}`);
  } else if (a.status === 'expired') {
    lines.push(`  *Expired:* ${a.expiresAt}`);
  } else if ((a.status === 'failed' || a.status === 'execution_failed') && a.executedAt) {
    lines.push(`  *Failed:* ${a.executedAt}`);
  }

  if (a.resultJobId) {
    lines.push(`  *Job ID:* \`${a.resultJobId}\``);
  }

  if (a.driveLink) {
    lines.push(`  *Drive Link Status:* \`yes\``);
  }

  const preview = a.inputPreview ? a.inputPreview.substring(0, 100) : '';
  // Sanitize absolute path patterns just in case they slipped into preview
  const safePreview = preview
    .replace(/[a-zA-Z]:\\[\\\w\s.-]+/g, 'openclaw/outbox/')
    .replace(/\/[\w\s.-]+\/[\w\s.-]+/g, 'openclaw/outbox/');
  lines.push(`  *Preview:* ${safePreview}`);
  lines.push(`  *Next command:* /approval_info ${a.approvalId}`);

  return lines.join('\n');
}

module.exports = {
  createApproval,
  getApproval,
  listApprovals,
  rejectApproval,
  transitionToApproved,
  transitionToExecuted,
  transitionToExecutionFailed,
  sanitizeApprovalSearchQuery,
  getApprovalHistory,
  searchApprovals,
  getApprovalsByStatus,
  cleanupExpiredApprovals,
  summarizeApprovalForTelegram
};
