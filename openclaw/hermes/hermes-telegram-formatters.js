const fs = require('fs');
const path = require('path');
const store = require('./hermes-queue-store');
const engine = require('./hermes-queue-engine');

/**
 * Format status information for /hermes_status command.
 * @returns {string}
 */
function formatHermesStatus() {
  const queuePath = store.getQueueFilePath();
  const queueExists = fs.existsSync(queuePath);
  
  let totalJobs = 0;
  let activeJobs = 0;
  let completedJobs = 0;
  let failedJobs = 0;
  let awaitingApprovalJobs = 0;
  let latestJobId = 'None';

  if (queueExists) {
    const queue = store.loadQueue();
    const jobs = Object.values(queue);
    totalJobs = jobs.length;
    
    if (totalJobs > 0) {
      const sorted = [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      latestJobId = sorted[0].hermesJobId;
    }

    activeJobs = jobs.filter(j => ['queued', 'triaged', 'approved', 'dispatched', 'running'].includes(j.status)).length;
    completedJobs = jobs.filter(j => j.status === 'completed').length;
    failedJobs = jobs.filter(j => j.status === 'failed').length;
    awaitingApprovalJobs = jobs.filter(j => j.status === 'awaiting_approval').length;
  }

  return [
    `🕊️ *Hermes System Status*`,
    ``,
    `• *Queue Store File:* ${queueExists ? 'Exists' : 'Not Initialized'}`,
    `• *Total Jobs:* ${totalJobs}`,
    `• *Active Jobs:* ${activeJobs}`,
    `• *Completed Jobs:* ${completedJobs}`,
    `• *Failed Jobs:* ${failedJobs}`,
    `• *Awaiting Approval:* ${awaitingApprovalJobs}`,
    `• *Latest Job ID:* \`${latestJobId}\``,
    `• *Real External Execution:* disabled`,
    `• *Connector Mode:* dry-run-only`
  ].join('\n');
}

/**
 * Format queue information for /hermes_queue command with optional filters.
 * @param {string} [filterArg]
 * @returns {string}
 */
function formatHermesQueue(filterArg) {
  const queue = store.loadQueue();
  let jobs = Object.values(queue);

  let title = '📋 *Hermes Queue*';
  if (filterArg) {
    const cleanFilter = filterArg.trim().toLowerCase();
    if (cleanFilter === 'active') {
      jobs = jobs.filter(j => ['queued', 'triaged', 'approved', 'dispatched', 'running'].includes(j.status));
      title = '📋 *Hermes Queue: Active Jobs*';
    } else if (cleanFilter === 'failed') {
      jobs = jobs.filter(j => j.status === 'failed');
      title = '📋 *Hermes Queue: Failed Jobs*';
    } else if (cleanFilter === 'approval' || cleanFilter === 'awaiting_approval') {
      jobs = jobs.filter(j => j.status === 'awaiting_approval');
      title = '📋 *Hermes Queue: Awaiting Approval Jobs*';
    } else if (cleanFilter === 'completed') {
      jobs = jobs.filter(j => j.status === 'completed');
      title = '📋 *Hermes Queue: Completed Jobs*';
    }
  }

  if (jobs.length === 0) {
    return `${title}\n\nNo jobs found matching the filter.`;
  }

  // Sort descending by creation date, limit to last 10
  const sorted = jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10);

  let output = `${title} (showing last ${sorted.length})\n\n`;
  sorted.forEach(j => {
    const shortInput = j.inputSummary.length > 50 ? j.inputSummary.substring(0, 47) + '...' : j.inputSummary;
    output += `• *ID:* \`${j.hermesJobId}\` | *Status:* \`${j.status.toUpperCase()}\` | *Bot:* \`${j.botId}\` | *Priority:* \`${j.priority}\` | *By:* \`${j.requestedBy}\` | *Updated:* ${j.updatedAt}\n`;
    output += `  *Input:* _${shortInput}_\n\n`;
  });

  return output.trim();
}

/**
 * Format latest job details for /hermes_latest command.
 * @returns {string}
 */
function formatHermesLatest() {
  const queue = store.loadQueue();
  const jobs = Object.values(queue);
  if (jobs.length === 0) {
    return `No jobs found in Hermes queue.`;
  }

  const latest = jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const lastEvent = latest.events && latest.events.length > 0 ? latest.events[latest.events.length - 1] : null;
  const eventStr = lastEvent ? `[${lastEvent.timestamp}] ${lastEvent.message}` : 'None';

  let msg = `🕊️ *Latest Hermes Job: ${latest.hermesJobId}*\n\n`;
  msg += `• *Status:* \`${latest.status.toUpperCase()}\`\n`;
  msg += `• *Bot Slug:* \`${latest.botId}\`\n`;
  if (latest.runtimeJobId) msg += `• *Runtime Job ID:* \`${latest.runtimeJobId}\`\n`;
  if (latest.approvalId) msg += `• *Approval ID:* \`${latest.approvalId}\`\n`;
  if (latest.outputPath) msg += `• *Output Path:* \`${latest.outputPath}\`\n`;
  if (latest.driveLink) msg += `• *Drive Link:* ${latest.driveLink}\n`;
  if (latest.safeMessage) msg += `• *Safe Message:* ${latest.safeMessage}\n`;
  msg += `• *Latest Event:* _${eventStr}_\n`;

  return msg;
}

/**
 * Format details of a specific job for /hermes_read command.
 * @param {string} jobId
 * @returns {string}
 */
function formatHermesRead(jobId) {
  if (!jobId || !jobId.trim()) {
    return `Usage: /hermes_read <hermesJobId>`;
  }

  const cleanId = jobId.trim();
  const queue = store.loadQueue();
  const job = queue[cleanId];
  if (!job) {
    return `❌ Error: Job \`${cleanId}\` not found in queue.`;
  }

  let msg = `🕊️ *Hermes Job Details: ${job.hermesJobId}*\n\n`;
  msg += `• *Status:* \`${job.status.toUpperCase()}\`\n`;
  msg += `• *Priority:* \`${job.priority}\`\n`;
  msg += `• *Requested By:* \`${job.requestedBy}\`\n`;
  msg += `• *Bot Slug:* \`${job.botId}\`\n`;
  if (job.runtimeJobId) msg += `• *Runtime Job ID:* \`${job.runtimeJobId}\`\n`;
  if (job.approvalId) msg += `• *Approval ID:* \`${job.approvalId}\`\n`;
  if (job.outputPath) msg += `• *Output Path:* \`${job.outputPath}\`\n`;
  if (job.driveLink) msg += `• *Drive Link:* ${job.driveLink}\n`;
  if (job.errorCategory) msg += `• *Error Category:* \`${job.errorCategory}\`\n`;
  if (job.safeMessage) msg += `• *Safe Message:* ${job.safeMessage}\n`;
  msg += `• *Created:* ${job.createdAt}\n`;
  msg += `• *Updated:* ${job.updatedAt}\n\n`;

  msg += `*Input Summary:*\n_${job.inputSummary}_\n\n`;

  msg += `*Lifecycle Events (Last 5):*\n`;
  const events = job.events || [];
  const lastFive = events.slice(-5);
  if (lastFive.length === 0) {
    msg += `(No events recorded)`;
  } else {
    lastFive.forEach(e => {
      msg += `• [${e.timestamp}] ${e.message}\n`;
    });
  }

  return msg.trim();
}

/**
 * Format awaiting approvals for /hermes_approval command.
 * @returns {string}
 */
function formatHermesApproval() {
  const queue = store.loadQueue();
  const jobs = Object.values(queue).filter(j => j.status === 'awaiting_approval');

  if (jobs.length === 0) {
    return `📋 *Hermes Approvals*\n\nNo jobs awaiting approval.`;
  }

  const sorted = jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  let output = `📋 *Hermes Jobs Awaiting Approval* (showing ${sorted.length})\n\n`;
  sorted.forEach(j => {
    const shortInput = j.inputSummary.length > 60 ? j.inputSummary.substring(0, 57) + '...' : j.inputSummary;
    output += `• *Job ID:* \`${j.hermesJobId}\`\n`;
    output += `  *Approval ID:* \`${j.approvalId || 'None'}\`\n`;
    output += `  *Bot Slug:* \`${j.botId}\`\n`;
    output += `  *Requested By:* \`${j.requestedBy}\`\n`;
    output += `  *Created:* ${j.createdAt}\n`;
    output += `  *Input:* _${shortInput}_\n`;
    if (j.safeMessage) output += `  *Message:* ${j.safeMessage}\n`;
    output += `  *To approve:* /approve_run ${j.approvalId || ''}\n\n`;
  });

  return output.trim();
}

module.exports = {
  formatHermesStatus,
  formatHermesQueue,
  formatHermesLatest,
  formatHermesRead,
  formatHermesApproval
};
