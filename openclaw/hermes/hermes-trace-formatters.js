/**
 * OpenClaw Hermes Trace and Report Formatters
 */

/**
 * Formats a single job into a clean, concise one-line summary.
 * @param {object} job Sanitized Hermes job
 * @returns {string}
 */
function formatOneLineSummary(job) {
  if (!job) return 'No job details available.';
  const shortInput = job.inputSummary && job.inputSummary.length > 40
    ? job.inputSummary.substring(0, 37) + '...'
    : (job.inputSummary || 'None');
  
  return `• *ID:* \`${job.hermesJobId}\` | *Status:* \`${job.status.toUpperCase()}\` | *Bot:* \`${job.botId}\` | *Input:* _${shortInput}_`;
}

/**
 * Formats a detailed lifecycle trace showing request path to final results.
 * @param {object} job Sanitized Hermes job
 * @returns {string}
 */
function formatDetailedTrace(job) {
  if (!job) return 'No trace details available.';

  const reqId = job.metadata?.requestId || 'None';
  const workflow = job.metadata?.workflow || 'None';

  let msg = `🕊️ *Hermes Execution Trace: ${job.hermesJobId}*\n\n`;
  
  msg += `📥 *1. Inbox Request (Trigger)*\n`;
  msg += `• *Request ID:* \`${reqId}\`\n`;
  msg += `• *Source:* \`${job.source}\`\n`;
  msg += `• *Requested By:* \`${job.requestedBy}\`\n\n`;

  msg += `🕊️ *2. Hermes Triage & Queue*\n`;
  msg += `• *Priority:* \`${job.priority}\`\n`;
  msg += `• *Bot Slug:* \`${job.botId}\`\n`;
  msg += `• *Workflow ID:* \`${workflow}\`\n`;
  msg += `• *Created:* ${job.createdAt}\n`;
  msg += `• *Updated:* ${job.updatedAt}\n`;
  msg += `• *Input Summary:* _${job.inputSummary || 'None'}_\n\n`;

  msg += `⚙️ *3. Runtime Dispatch*\n`;
  msg += `• *Runtime Job ID:* \`${job.runtimeJobId || 'None'}\`\n`;
  msg += `• *Approval Gate ID:* \`${job.approvalId || 'None'}\`\n\n`;

  msg += `🏁 *4. Outcome / Results*\n`;
  msg += `• *Final Status:* \`${job.status.toUpperCase()}\`\n`;
  if (job.outputPath) msg += `• *Output File:* \`${job.outputPath}\`\n`;
  if (job.driveLink) msg += `• *Drive Link:* ${job.driveLink}\n`;
  if (job.errorCategory) msg += `• *Error Category:* \`${job.errorCategory}\`\n`;
  if (job.safeMessage) msg += `• *Message:* ${job.safeMessage}\n`;

  msg += `\n*Trace Flow Diagram:*\n`;
  msg += `Inbox Request → [Hermes Job: \`${job.hermesJobId}\`]`;
  if (job.approvalId) msg += ` → [Approval: \`${job.approvalId}\`]`;
  if (job.runtimeJobId) msg += ` → [Runtime Job: \`${job.runtimeJobId}\`]`;
  msg += ` → \`${job.status.toUpperCase()}\``;
  
  if (job.events && job.events.length > 0) {
    msg += `\n\n*Lifecycle History (Last 5 Events):*\n`;
    const lastFive = job.events.slice(-5);
    lastFive.forEach(e => {
      msg += `• [${e.timestamp}] ${e.message}\n`;
    });
  }

  return msg.trim();
}

/**
 * Formats a list of failed jobs into a detailed failure summary.
 * @param {object[]} failedJobs Sanitized failed Hermes jobs
 * @returns {string}
 */
function formatFailureSummary(failedJobs) {
  if (!failedJobs || failedJobs.length === 0) {
    return `📋 *Hermes Failed Jobs Summary*\n\nNo failed jobs found in the queue.`;
  }

  let msg = `📋 *Hermes Recent Failed Jobs (Showing ${failedJobs.length})*\n\n`;
  failedJobs.forEach((job, idx) => {
    msg += `*${idx + 1}. Job ID:* \`${job.hermesJobId}\`\n`;
    msg += `  • *Bot Slug:* \`${job.botId}\` | *Requested By:* \`${job.requestedBy}\`\n`;
    msg += `  • *Error Category:* \`${job.errorCategory || 'None'}\`\n`;
    msg += `  • *Safe Message:* _${job.safeMessage || 'No details'}_\n`;
    msg += `  • *Failed At:* ${job.updatedAt}\n\n`;
  });

  return msg.trim();
}

/**
 * Formats a list of jobs awaiting approval.
 * @param {object[]} approvalJobs Sanitized Hermes jobs in awaiting_approval status
 * @returns {string}
 */
function formatApprovalSummary(approvalJobs) {
  if (!approvalJobs || approvalJobs.length === 0) {
    return `📋 *Hermes Pending Approvals*\n\nNo jobs currently awaiting approval.`;
  }

  let msg = `📋 *Hermes Jobs Awaiting Approval (${approvalJobs.length})*\n\n`;
  approvalJobs.forEach((job, idx) => {
    const shortInput = job.inputSummary && job.inputSummary.length > 40
      ? job.inputSummary.substring(0, 37) + '...'
      : (job.inputSummary || 'None');
    msg += `*${idx + 1}. Job ID:* \`${job.hermesJobId}\`\n`;
    msg += `  • *Approval ID:* \`${job.approvalId || 'None'}\`\n`;
    msg += `  • *Bot Slug:* \`${job.botId}\` | *Requested By:* \`${job.requestedBy}\`\n`;
    msg += `  • *Created:* ${job.createdAt}\n`;
    msg += `  • *Input:* _${shortInput}_\n`;
    msg += `  • *Approve command:* \`/hermes_approve ${job.approvalId || ''}\`\n\n`;
  });

  return msg.trim();
}

/**
 * Formats the queue health diagnostics dashboard.
 * @param {object} health Sanitized health stats object
 * @returns {string}
 */
function formatQueueHealthSummary(health) {
  if (!health) return 'No queue health stats available.';

  return [
    `🕊️ *Hermes Queue Health & Diagnostics*`,
    ``,
    `• *Total Jobs:* ${health.totalJobs}`,
    `• *Active Jobs:* ${health.activeJobs}`,
    `• *Queued:* ${health.queuedJobs} | *Awaiting Approval:* ${health.awaitingApprovalJobs} | *Running/Dispatched:* ${health.dispatchedRunningJobs}`,
    `• *Completed:* ${health.completedJobs} | *Failed:* ${health.failedJobs} | *Blocked:* ${health.blockedJobs}`,
    `• *Canceled:* ${health.canceledJobs} | *Duplicate Rejections:* ${health.duplicateRejectionCount}`,
    ``,
    `• *Latest Job ID:* \`${health.latestJobId || 'None'}\``,
    `• *Latest Completed ID:* \`${health.latestCompletedJobId || 'None'}\``,
    `• *Latest Failed ID:* \`${health.latestFailedJobId || 'None'}\``,
    `• *Oldest Active ID:* \`${health.oldestActiveJob || 'None'}\``,
    ``,
    `🛡️ *Security & Connector Status:*`,
    `• *Real External Execution:* ${health.realExternalExecutionDisabled ? 'disabled' : 'enabled'}`,
    `• *Connector Mode:* \`${health.connectorMode}\``
  ].join('\n');
}

module.exports = {
  formatOneLineSummary,
  formatDetailedTrace,
  formatFailureSummary,
  formatApprovalSummary,
  formatQueueHealthSummary
};
