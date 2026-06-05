/**
 * OpenClaw Hermes Observability & Diagnostics
 */

const fs = require('fs');
const path = require('path');
const store = require('./hermes-queue-store');
const formatters = require('./hermes-trace-formatters');
const { getWorkspaceRoot } = require('../runtime/bot-loader');

/**
 * Escapes characters for a regex literal.
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sanitizes stack traces, absolute paths, and secrets from a string.
 * @param {string} val Raw text
 * @returns {string} Sanitized text
 */
function sanitizeString(val) {
  if (typeof val !== 'string') return val;
  
  // 1. Redact lines starting with whitespace and "at " (stack trace lines)
  let cleaned = val.split('\n')
    .filter(line => !/^\s+at\s+/i.test(line))
    .join('\n');

  // 2. Resolve and escape the workspace root path
  try {
    const wsRoot = getWorkspaceRoot();
    if (wsRoot) {
      const escapedRoot = escapeRegExp(wsRoot);
      // Replace with backslashes
      const rootRegexBack = new RegExp(escapedRoot, 'gi');
      cleaned = cleaned.replace(rootRegexBack, '[workspace]');
      
      // Replace with forward slashes
      const escapedRootForward = escapeRegExp(wsRoot.replace(/\\/g, '/'));
      const rootRegexForward = new RegExp(escapedRootForward, 'gi');
      cleaned = cleaned.replace(rootRegexForward, '[workspace]');
    }
  } catch (err) {}

  // Redact typical home folder path structures on Windows
  cleaned = cleaned.replace(/[A-Za-z]:\\Users\\[^\s\\]+\\/gi, '[workspace]/');
  cleaned = cleaned.replace(/[A-Za-z]:\\Users\\[^\s\\]+/gi, '[user_dir]');

  // 3. Redact common credential/secret patterns (just in case they leak into inputs or logs)
  cleaned = cleaned.replace(/(sk-[a-zA-Z0-9_-]{30,})/g, '[SECRET_REDACTED]');
  cleaned = cleaned.replace(/(xox[pbotr]-[a-zA-Z0-9-]{10,})/g, '[SECRET_REDACTED]');
  cleaned = cleaned.replace(/(ghp_[a-zA-Z0-9]{36})/g, '[SECRET_REDACTED]');

  return cleaned;
}

/**
 * Deep sanitization for event objects.
 * @param {object} event Trace event log
 * @returns {object} Sanitized event clone
 */
function sanitizeHermesTraceEvent(event) {
  if (!event) return null;
  const clone = JSON.parse(JSON.stringify(event));
  if (typeof clone === 'string') {
    return sanitizeString(clone);
  }
  if (clone.message) {
    clone.message = sanitizeString(clone.message);
  }
  return clone;
}

/**
 * Deep sanitization for values (including arrays or nested objects).
 */
function sanitizeValueDeep(val) {
  if (typeof val === 'string') {
    return sanitizeString(val);
  }
  if (Array.isArray(val)) {
    return val.map(sanitizeValueDeep);
  }
  if (val && typeof val === 'object') {
    const res = {};
    for (const [k, v] of Object.entries(val)) {
      res[k] = sanitizeValueDeep(v);
    }
    return res;
  }
  return val;
}

/**
 * Deep-clones and sanitizes a Hermes job, removing stack traces, absolute paths, and keys.
 * @param {object} job Raw Hermes job
 * @returns {object|null} Sanitized job, or null
 */
function sanitizeHermesObservableJob(job) {
  if (!job) return null;
  const clone = JSON.parse(JSON.stringify(job));

  if (clone.safeMessage) clone.safeMessage = sanitizeString(clone.safeMessage);
  if (clone.inputSummary) clone.inputSummary = sanitizeString(clone.inputSummary);
  if (clone.outputPath) clone.outputPath = sanitizeString(clone.outputPath);
  if (clone.driveLink) clone.driveLink = sanitizeString(clone.driveLink);

  if (Array.isArray(clone.events)) {
    clone.events = clone.events.map(sanitizeHermesTraceEvent);
  }

  if (clone.metadata && typeof clone.metadata === 'object') {
    for (const key of Object.keys(clone.metadata)) {
      if (typeof clone.metadata[key] === 'string') {
        clone.metadata[key] = sanitizeString(clone.metadata[key]);
      } else if (clone.metadata[key] && typeof clone.metadata[key] === 'object') {
        clone.metadata[key] = sanitizeValueDeep(clone.metadata[key]);
      }
    }
  }

  return clone;
}

/**
 * Scans the rejected inbox directory to count duplicate rejections.
 * @returns {number}
 */
function _getDuplicateRejectionCount() {
  try {
    const inboxDir = path.join(getWorkspaceRoot(), 'openclaw', 'inbox', 'telegram-requests');
    const rejectedDir = path.join(inboxDir, 'rejected');
    if (!fs.existsSync(rejectedDir)) return 0;

    const files = fs.readdirSync(rejectedDir);
    let count = 0;
    for (const file of files) {
      if (file.endsWith('.reject.txt')) {
        try {
          const content = fs.readFileSync(path.join(rejectedDir, file), 'utf8');
          if (content.toLowerCase().includes('duplicate')) {
            count++;
          }
        } catch (e) {}
      }
    }
    return count;
  } catch (err) {
    return 0;
  }
}

/**
 * Computes queue diagnostics and security metrics.
 * @returns {object} Health statistics
 */
function getHermesQueueHealth() {
  const queue = store.loadQueue();
  const jobs = Object.values(queue);

  const totalJobs = jobs.length;
  const activeJobs = jobs.filter(j => ['queued', 'triaged', 'awaiting_approval', 'approved', 'dispatched', 'running'].includes(j.status)).length;
  const queuedJobs = jobs.filter(j => j.status === 'queued').length;
  const awaitingApprovalJobs = jobs.filter(j => j.status === 'awaiting_approval').length;
  const dispatchedRunningJobs = jobs.filter(j => ['dispatched', 'running'].includes(j.status)).length;
  const completedJobs = jobs.filter(j => j.status === 'completed').length;
  const failedJobs = jobs.filter(j => j.status === 'failed').length;
  const blockedJobs = jobs.filter(j => j.status === 'blocked').length;
  const canceledJobs = jobs.filter(j => j.status === 'canceled').length;

  let latestJobId = null;
  let latestCompletedJobId = null;
  let latestFailedJobId = null;
  let oldestActiveJob = null;

  if (totalJobs > 0) {
    const sortedByCreatedDesc = [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    latestJobId = sortedByCreatedDesc[0].hermesJobId;

    const completed = jobs.filter(j => j.status === 'completed');
    if (completed.length > 0) {
      latestCompletedJobId = completed.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0].hermesJobId;
    }

    const failed = jobs.filter(j => j.status === 'failed');
    if (failed.length > 0) {
      latestFailedJobId = failed.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0].hermesJobId;
    }

    const active = jobs.filter(j => ['queued', 'triaged', 'awaiting_approval', 'approved', 'dispatched', 'running'].includes(j.status));
    if (active.length > 0) {
      oldestActiveJob = active.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0].hermesJobId;
    }
  }

  // Load connector details
  let realExternalExecutionDisabled = true;
  let connectorMode = 'dry-run-only';
  try {
    const { listConnectors } = require('../runtime/connector-registry');
    const connectors = listConnectors();
    realExternalExecutionDisabled = !connectors.some(c => c.realExecutionEnabled === true);
  } catch (err) {}

  const duplicateRejectionCount = _getDuplicateRejectionCount();

  return {
    totalJobs,
    activeJobs,
    queuedJobs,
    awaitingApprovalJobs,
    dispatchedRunningJobs,
    completedJobs,
    failedJobs,
    blockedJobs,
    canceledJobs,
    duplicateRejectionCount,
    latestJobId,
    latestCompletedJobId,
    latestFailedJobId,
    oldestActiveJob,
    realExternalExecutionDisabled,
    connectorMode
  };
}

/**
 * Builds a markdown queue summary report.
 * @returns {string}
 */
function buildHermesQueueSummary() {
  const health = getHermesQueueHealth();
  return formatters.formatQueueHealthSummary(health);
}

/**
 * Builds a status breakdown text.
 * @returns {string}
 */
function buildHermesStatusBreakdown() {
  const health = getHermesQueueHealth();
  return [
    `📊 *Hermes Status Breakdown:*`,
    `• QUEUED: ${health.queuedJobs}`,
    `• AWAITING APPROVAL: ${health.awaitingApprovalJobs}`,
    `• RUNNING/DISPATCHED: ${health.dispatchedRunningJobs}`,
    `• COMPLETED: ${health.completedJobs}`,
    `• FAILED: ${health.failedJobs}`,
    `• BLOCKED: ${health.blockedJobs}`,
    `• CANCELED: ${health.canceledJobs}`
  ].join('\n');
}

/**
 * Builds a failure summary report of recent failed jobs.
 * @param {number} [limit=10]
 * @returns {string}
 */
function buildHermesFailureSummary(limit = 10) {
  const queue = store.loadQueue();
  const failed = Object.values(queue)
    .filter(j => j.status === 'failed')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit)
    .map(sanitizeHermesObservableJob);

  return formatters.formatFailureSummary(failed);
}

/**
 * Builds a pending approvals summary report.
 * @param {number} [limit=10]
 * @returns {string}
 */
function buildHermesApprovalSummary(limit = 10) {
  const queue = store.loadQueue();
  const pending = Object.values(queue)
    .filter(j => j.status === 'awaiting_approval')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map(sanitizeHermesObservableJob);

  return formatters.formatApprovalSummary(pending);
}

/**
 * Groups and counts jobs per botSlug.
 * @returns {string}
 */
function buildHermesBotActivitySummary() {
  const queue = store.loadQueue();
  const jobs = Object.values(queue);
  
  const botCounts = {};
  jobs.forEach(j => {
    const slug = j.botId || 'unknown';
    botCounts[slug] = (botCounts[slug] || 0) + 1;
  });

  let msg = `🤖 *Hermes Bot Activity Summary*\n\n`;
  const sortedBots = Object.entries(botCounts).sort((a, b) => b[1] - a[1]);
  
  if (sortedBots.length === 0) {
    msg += 'No job activity logged.';
  } else {
    sortedBots.forEach(([bot, count]) => {
      msg += `• \`${bot}\`: ${count} job(s)\n`;
    });
  }

  return msg.trim();
}

/**
 * Synthesizes a detailed trace report for a specific job.
 * @param {string} hermesJobId
 * @returns {string}
 */
function buildHermesTrace(hermesJobId) {
  if (!hermesJobId) return 'Usage: /hermes_trace <hermesJobId>';
  
  const queue = store.loadQueue();
  const job = queue[hermesJobId.trim()];
  if (!job) {
    return `❌ Error: Job \`${hermesJobId}\` not found in queue.`;
  }

  const sanitized = sanitizeHermesObservableJob(job);
  return formatters.formatDetailedTrace(sanitized);
}

/**
 * Finds the latest job matching conditions and returns its trace representation.
 * @param {object} filters Search conditions
 * @returns {string}
 */
function buildHermesLatestTrace(filters = {}) {
  const { findLatestHermesJob } = require('./hermes-queue-engine');
  const job = findLatestHermesJob(filters);
  if (!job) {
    return 'No matching job found to trace.';
  }
  return buildHermesTrace(job.hermesJobId);
}

module.exports = {
  getHermesQueueHealth,
  buildHermesQueueSummary,
  buildHermesStatusBreakdown,
  buildHermesFailureSummary,
  buildHermesApprovalSummary,
  buildHermesBotActivitySummary,
  buildHermesTrace,
  buildHermesLatestTrace,
  sanitizeHermesObservableJob,
  sanitizeHermesTraceEvent,
  sanitizeString
};
