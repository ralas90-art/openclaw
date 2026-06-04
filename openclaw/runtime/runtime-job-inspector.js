/**
 * OpenClaw Runtime Job Inspector & Telemetry Lookup
 */

const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot } = require('./bot-loader');
const { isValidRuntimeJobId } = require('./runtime-job-id');
const { readEvents } = require('./runtime-logger');
const { sanitizeErrorMessage } = require('./runtime-metrics');

/**
 * Searches for the generated result file inside telegram-responses/ by checking
 * the event logs or scanning the directory safely.
 * @param {string} jobId
 * @returns {{ filename: string, fullPath: string }|null}
 */
function findResultFileByJobId(jobId) {
  if (!isValidRuntimeJobId(jobId)) {
    return null;
  }

  const workspaceRoot = getWorkspaceRoot();
  const targetDir = path.join(workspaceRoot, 'openclaw', 'outbox', 'telegram-responses');
  if (!fs.existsSync(targetDir)) {
    return null;
  }

  // 1. Try checking log events for a matching filename first
  const events = readEvents();
  for (const ev of events) {
    if (ev.jobId === jobId && ev.filename) {
      const filePath = path.join(targetDir, ev.filename);
      if (fs.existsSync(filePath)) {
        return { filename: ev.filename, fullPath: filePath };
      }
    }
  }

  // 2. Perform a safe content match check on files in telegram-responses
  try {
    const files = fs.readdirSync(targetDir).filter(f => f.endsWith('_runtime_result.md'));
    for (const f of files) {
      const filePath = path.join(targetDir, f);
      const stats = fs.statSync(filePath);
      if (stats.isFile()) {
        const content = fs.readFileSync(filePath, 'utf8');
        // Match either Unix or Windows newlines
        if (content.includes(`## Job ID\n${jobId}`) || content.includes(`## Job ID\r\n${jobId}`)) {
          return { filename: f, fullPath: filePath };
        }
      }
    }
  } catch (err) {
    console.warn(`[runtime-job-inspector] Directory scan warning: ${err.message}`);
  }

  return null;
}

/**
 * Gathers all event log records matching a given Job ID.
 * @param {string} jobId
 * @returns {object[]}
 */
function findEventsByJobId(jobId) {
  if (!isValidRuntimeJobId(jobId)) {
    return [];
  }
  return readEvents().filter(e => e.jobId === jobId);
}

/**
 * Resolves a consolidated telemetry view of a job execution.
 * @param {string} jobId
 * @returns {object|null}
 */
function getRuntimeJob(jobId) {
  if (!isValidRuntimeJobId(jobId)) {
    return null;
  }

  // Prefer job index lookup
  try {
    const { loadJobIndex } = require('./runtime-job-index');
    const index = loadJobIndex();
    if (index && index[jobId]) {
      const job = index[jobId];
      if (job.filename) {
        const workspaceRoot = getWorkspaceRoot();
        const filePath = path.join(workspaceRoot, 'openclaw', 'outbox', 'telegram-responses', job.filename);
        if (!fs.existsSync(filePath)) {
          job.filename = null;
        }
      }
      job.events = findEventsByJobId(jobId);
      return job;
    }
  } catch (err) {
    console.warn(`[runtime-job-inspector] Index lookup warning: ${err.message}`);
  }

  const events = findEventsByJobId(jobId);
  const fileInfo = findResultFileByJobId(jobId);

  if (events.length === 0 && !fileInfo) {
    return null;
  }

  // Consolidated aggregates
  let botSlug = null;
  let presetId = null;
  let command = null;
  let status = 'unknown';
  let durationMs = null;
  let published = false;
  let driveLink = null;
  let errorCategory = null;
  let safeMessage = null;
  let timestamp = null;
  let lastEventTime = null;

  for (const ev of events) {
    if (!timestamp) timestamp = ev.timestamp;
    lastEventTime = ev.timestamp;

    if (ev.botSlug) botSlug = ev.botSlug;
    if (ev.presetId) presetId = ev.presetId;
    if (ev.command) command = ev.command;
    if (ev.status) status = ev.status;
    if (ev.durationMs) durationMs = ev.durationMs;

    if (ev.published !== undefined) {
      published = ev.published;
    }
    if (ev.driveLink) {
      driveLink = ev.driveLink;
      published = true;
    }
    if (ev.publishStatus === 'published' || ev.publishStatus === 'already_published') {
      published = true;
    }
    if (ev.errorCategory) errorCategory = ev.errorCategory;
    if (ev.safeMessage) safeMessage = ev.safeMessage;
  }

  return {
    jobId,
    botSlug,
    presetId,
    command,
    status,
    durationMs,
    filename: fileInfo ? fileInfo.filename : null,
    published,
    driveLink,
    errorCategory,
    safeMessage,
    timestamp: timestamp || lastEventTime,
    lastEventTime: lastEventTime || timestamp,
    events
  };
}

/**
 * Formats a clean, Telegram-safe job inspection summary.
 * @param {string} jobId
 * @returns {string}
 */
function buildJobSummary(jobId) {
  if (!isValidRuntimeJobId(jobId)) {
    return '❌ Rejection: Invalid job ID format.';
  }

  const job = getRuntimeJob(jobId);
  if (!job) {
    return 'No runtime job found for that ID.';
  }

  const durationSec = job.durationMs ? `${(job.durationMs / 1000).toFixed(1)}s` : 'unknown';
  const formatTime = (t) => {
    if (!t) return 'None';
    const datePart = t.substring(0, 10);
    const timePart = t.substring(11, 19);
    return `${datePart} ${timePart}`;
  };

  let msg = [
    `🆔 *Job ID:* \`${job.jobId}\``
  ];

  if (job.presetId) {
    msg.push(`• *Preset Used:* \`${job.presetId}\``);
  }

  msg.push(
    `• *Command:* \`${job.command || 'unknown'}\``,
    `• *Bot:* \`${job.botSlug || 'unknown'}\``,
    `• *Status:* \`${job.status.toUpperCase()}\``,
    `• *File:* ${job.filename ? '`' + job.filename + '`' : '`none`'}`,
    `• *Published:* \`${job.published ? 'yes' : 'no'}\``,
    `• *Drive Link:* ${job.driveLink ? job.driveLink : '`none`'}`,
    `• *Duration:* \`${durationSec}\``,
    `• *Created:* \`${formatTime(job.timestamp)}\``,
    `• *Last Event:* \`${formatTime(job.lastEventTime)}\``
  );

  if (job.status === 'failure' || job.status === 'failed' || job.status === 'error' || job.status === 'rejected') {
    msg.push(`• *Error Category:* \`${job.errorCategory || 'internal_error'}\``);
    if (job.safeMessage) {
      msg.push(`• *Error Message:* ${sanitizeErrorMessage(job.safeMessage)}`);
    }
  }

  msg.push('');
  msg.push('*Next Commands:*');
  msg.push('• `/run_latest` — View details of the latest execution');
  msg.push('• `/run_history` — View recent execution history');
  msg.push('• `/drive_latest` — View the latest published Drive file');

  return msg.join('\n');
}

module.exports = {
  findResultFileByJobId,
  findEventsByJobId,
  getRuntimeJob,
  buildJobSummary
};
