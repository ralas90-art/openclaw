const { readEvents } = require('./runtime-logger');
const config = require('./runtime-config');
const { RUNTIME_ENABLED_BOTS } = require('./runtime-allowlist');
const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot } = require('./bot-loader');

/**
 * Aggregates runtime usage metrics from the JSONL log file.
 */
function getMetrics() {
  const events = readEvents();
  
  let totalExecutions = 0;
  let successRunBot = 0;
  let failedRunBot = 0;
  let successRunPublish = 0;
  let failedRunPublish = 0;
  let successRunPreset = 0;
  let failedRunPreset = 0;
  let successRunPresetPublish = 0;
  let failedRunPresetPublish = 0;
  let lastSuccessTime = null;
  let lastFailedTime = null;
  
  let publishSuccess = 0;
  let publishFailure = 0;
  
  let permissionDeniedCount = 0;
  let publishCommandCount = 0;
  let generateCommandCount = 0;
  let readOnlyCommandCount = 0;
  let selfApprovalDeniedCount = 0;
  
  const botCounts = {};
 
  for (const ev of events) {
    if (ev.selfApprovalDenied === true) {
      selfApprovalDeniedCount++;
    }
    if (ev.permissionDecision === 'denied' || (ev.status === 'failure' && ev.errorCategory === 'unauthorized')) {
      permissionDeniedCount++;
    }

    if (ev.type === 'runtime_execution') {
      totalExecutions++;
      let tier = ev.commandTier;
      if (!tier && ev.command) {
        try {
          const { getCommandRiskLevel } = require('./runtime-permissions');
          tier = getCommandRiskLevel(ev.command);
        } catch (err) {}
      }
      if (tier === 'publish') {
        publishCommandCount++;
      } else if (tier === 'generate_only') {
        generateCommandCount++;
      } else if (tier === 'read_only') {
        readOnlyCommandCount++;
      }

      const cmd = ev.command ? ev.command.toLowerCase() : '';
      if (cmd === 'run_bot') {
        if (ev.status === 'success') {
          successRunBot++;
          lastSuccessTime = ev.timestamp;
        } else {
          failedRunBot++;
          lastFailedTime = ev.timestamp;
        }
      } else if (cmd === 'run_publish' || cmd === 'rp' || cmd === 'run_bot_publish') {
        if (ev.status === 'success') {
          successRunPublish++;
          lastSuccessTime = ev.timestamp;
          if (ev.publishStatus === 'published' || ev.publishStatus === 'already_published') {
            publishSuccess++;
          } else {
            publishFailure++;
          }
        } else {
          failedRunPublish++;
          lastFailedTime = ev.timestamp;
          publishFailure++;
        }
      } else if (cmd === 'run_preset') {
        if (ev.status === 'success') {
          successRunPreset++;
          lastSuccessTime = ev.timestamp;
        } else {
          failedRunPreset++;
          lastFailedTime = ev.timestamp;
        }
      } else if (cmd === 'run_preset_publish') {
        if (ev.status === 'success') {
          successRunPresetPublish++;
          lastSuccessTime = ev.timestamp;
          if (ev.publishStatus === 'published' || ev.publishStatus === 'already_published') {
            publishSuccess++;
          } else {
            publishFailure++;
          }
        } else {
          failedRunPresetPublish++;
          lastFailedTime = ev.timestamp;
          publishFailure++;
        }
      }
      
      if (ev.botSlug) {
        botCounts[ev.botSlug] = (botCounts[ev.botSlug] || 0) + 1;
      }
    } else if (ev.type === 'drive_publish') {
      if (ev.status === 'success' || ev.status === 'already_published' || ev.publishStatus === 'published' || ev.publishStatus === 'already_published') {
        publishSuccess++;
      } else {
        publishFailure++;
      }
    }
  }
 
  let mostUsedBot = null;
  let maxCount = 0;
  for (const [bot, count] of Object.entries(botCounts)) {
    if (count > maxCount) {
      maxCount = count;
      mostUsedBot = bot;
    }
  }
 
  let pendingApprovals = 0;
  let approvedApprovals = 0;
  let rejectedApprovals = 0;
  let expiredApprovals = 0;
  let executedApprovals = 0;
  let failedApprovals = 0;
  let approvalsLength = 0;

  try {
    const { getApprovalHistory } = require('./runtime-approvals');
    const approvals = getApprovalHistory(9999);
    approvalsLength = approvals.length;
    for (const a of approvals) {
      if (a.status === 'pending') pendingApprovals++;
      else if (a.status === 'approved') approvedApprovals++;
      else if (a.status === 'rejected') rejectedApprovals++;
      else if (a.status === 'expired') expiredApprovals++;
      else if (a.status === 'executed') executedApprovals++;
      else if (a.status === 'failed' || a.status === 'execution_failed') failedApprovals++;
    }
  } catch (err) {}

  return {
    totalExecutions,
    successRunBot,
    failedRunBot,
    successRunPublish,
    failedRunPublish,
    successRunPreset,
    failedRunPreset,
    successRunPresetPublish,
    failedRunPresetPublish,
    lastSuccessTime,
    lastFailedTime,
    mostUsedBot,
    publishSuccess,
    publishFailure,
    permissionDeniedCount,
    publishCommandCount,
    generateCommandCount,
    readOnlyCommandCount,
    pendingApprovalsCount: pendingApprovals,
    approvedApprovalsCount: approvedApprovals + executedApprovals,
    rejectedApprovalsCount: rejectedApprovals,
    expiredApprovalsCount: expiredApprovals,
    approvalExecutionFailureCount: failedApprovals,
    // New exact keys required by prompt:
    approvalHistoryCount: approvalsLength,
    pendingApprovals,
    approvedApprovals,
    rejectedApprovals,
    expiredApprovals,
    executedApprovals,
    failedApprovals,
    selfApprovalDeniedCount
  };
}

/**
 * Returns the last N sanitized errors.
 */
function getRecentErrors(limit = 5) {
  const events = readEvents();
  const errors = [];
  
  for (const ev of events) {
    const isExecutionFailure = ev.type === 'runtime_execution' && ev.status === 'failure';
    const isDriveFailure = ev.type === 'drive_publish' && (ev.status === 'failure' || ev.status === 'failed');
    if (isExecutionFailure || isDriveFailure) {
      errors.push(ev);
    }
  }
  
  // Return last limit errors, newest first
  const recent = errors.slice(-limit).reverse();
  
  return recent.map(err => {
    return {
      jobId: err.jobId || null,
      timestamp: err.timestamp,
      command: err.command || (err.type === 'drive_publish' ? 'drive_publish' : 'unknown'),
      botSlug: err.botSlug || null,
      errorCategory: err.errorCategory || 'internal_error',
      safeMessage: sanitizeErrorMessage(err.safeMessage || err.message || 'An unknown error occurred.')
    };
  });
}

/**
 * Sanitizes an error message: removes stack traces, local paths, credentials, and API keys.
 */
function sanitizeErrorMessage(msg) {
  if (!msg) return 'An unknown error occurred.';
  let clean = msg;
  
  // Replace absolute Windows paths (e.g. C:\Users\...)
  clean = clean.replace(/[a-zA-Z]:\\[\\\w\s.-]+/g, 'openclaw/outbox/');
  // Replace absolute POSIX paths (e.g. /app/...)
  clean = clean.replace(/\/[\w\s.-]+\/[\w\s.-]+/g, 'openclaw/outbox/');
  
  // Strip stack traces
  const lines = clean.split('\n');
  const filteredLines = lines.filter(l => !l.trim().startsWith('at ') && !l.includes('node_modules'));
  clean = filteredLines.join('\n').trim();
  
  // Strip potential API keys / secrets
  clean = clean.replace(/sk-[a-zA-Z0-9]{20,}/g, 'sk-***');
  clean = clean.replace(/AIzaSy[a-zA-Z0-9-_]{33}/g, 'AIzaSy***');
  
  return clean;
}

/**
 * Returns safe configuration info.
 */
function getSafeConfig() {
  const workspaceRoot = getWorkspaceRoot();
  const responsesDir = path.join(workspaceRoot, 'openclaw', 'outbox', 'telegram-responses');
  
  let outboxCount = 0;
  try {
    if (fs.existsSync(responsesDir)) {
      outboxCount = fs.readdirSync(responsesDir).filter(f => !f.startsWith('.')).length;
    }
  } catch (err) {}
  
  let presetCount = 0;
  try {
    const presetsPath = path.join(workspaceRoot, 'openclaw', 'runtime', 'runtime-presets.json');
    if (fs.existsSync(presetsPath)) {
      const presets = JSON.parse(fs.readFileSync(presetsPath, 'utf8'));
      presetCount = Object.keys(presets).length;
    }
  } catch (err) {}
  
  return {
    status: 'online',
    modelProvider: config.provider || 'unknown',
    defaultModel: process.env.OPENCLAW_MODEL || 'default-model',
    approvedBots: RUNTIME_ENABLED_BOTS,
    controlledPublishingEnabled: true,
    manualPublishingEnabled: true,
    outboxResultCount: outboxCount,
    runtimeResultDirectoryLabel: 'openclaw/outbox/telegram-responses/',
    drivePublishingMode: process.env.GOOGLE_DRIVE_PUBLISH_MODE || 'local',
    presetsEnabled: 'yes',
    presetCount: presetCount,
    publishingPresetsEnabled: 'yes',
    permissionTiersEnabled: 'yes',
    accessModel: 'role-based with admin fallback',
    roleSystem: 'Enabled',
    selfApprovalProtection: 'Enabled',
    superAdminCount: (() => {
      try {
        const roles = require('./runtime-roles');
        return roles.getRoleSummary().super_admin;
      } catch (e) { return 0; }
    })(),
    operatorCount: (() => {
      try {
        const roles = require('./runtime-roles');
        return roles.getRoleSummary().operator;
      } catch (e) { return 0; }
    })(),
    publisherCount: (() => {
      try {
        const roles = require('./runtime-roles');
        return roles.getRoleSummary().publisher;
      } catch (e) { return 0; }
    })(),
    approverCount: (() => {
      try {
        const roles = require('./runtime-roles');
        return roles.getRoleSummary().approver;
      } catch (e) { return 0; }
    })(),
    viewerCount: (() => {
      try {
        const roles = require('./runtime-roles');
        return roles.getRoleSummary().viewer;
      } catch (e) { return 0; }
    })(),
    externalActionsEnabled: 'no',
    approvalGates: 'Enabled',
    approvalTtlMinutes: parseInt(process.env.OPENCLAW_APPROVAL_TTL_MINUTES, 10) || 60,
    gatedTiers: ['publish'],
    pendingApprovalsCount: (() => {
      try {
        const { listApprovals } = require('./runtime-approvals');
        return listApprovals(9999).filter(a => a.status === 'pending').length;
      } catch (err) {
        return 0;
      }
    })(),
    approvalAudit: 'Enabled',
    approvalSearch: 'Enabled',
    expiredCleanup: 'Available',
    enabledCommands: [
      '/help', '/bots', '/registry', '/inbox', '/inbox_read', '/inbox_latest',
      '/run_bot', '/run_publish', '/run_status', '/run_latest', '/run_history',
      '/run_metrics', '/run_errors', '/run_config', '/run_job',
      '/run_search', '/run_by_bot', '/run_reindex',
      '/preset_list', '/preset_info', '/run_preset', '/run_preset_publish',
      '/run_permissions', '/run_roles', '/my_role',
      '/drive_latest', '/drive_publish_latest', '/drive_publish_pending',
      '/drive_republish_latest', '/drive_publish_file', '/drive_publish_campaign',
      '/approval_list', '/approval_info', '/approve_run', '/reject_run',
      '/approval_history', '/approval_search', '/approval_by_status', '/approval_cleanup_expired'
    ]
  };
}

module.exports = {
  getMetrics,
  getRecentErrors,
  getSafeConfig,
  sanitizeErrorMessage
};
