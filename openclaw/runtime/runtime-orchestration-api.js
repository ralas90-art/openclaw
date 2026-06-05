/**
 * OpenClaw Runtime Orchestration API
 * Exposes a stable internal interface for Hermes and local tools.
 */

const fs = require('fs');
const path = require('path');
const { generateRuntimeJobId } = require('./runtime-job-id');
const { requireCommandPermission } = require('./runtime-permissions');
const { runBot } = require('./runtime-executor');
const { runPreset } = require('./runtime-presets');
const { createApproval, getApproval } = require('./runtime-approvals');
const { createDryRunPreview, getDryRunRecord } = require('./runtime-dryrun');
const { getRuntimeJob } = require('./runtime-job-inspector');
const { getRuntimeStatus } = require('./runtime-inspector');

const VALID_SOURCES = ['telegram', 'hermes', 'test', 'system'];

function validateSource(source) {
  if (!source || !VALID_SOURCES.includes(source)) {
    return {
      ok: false,
      status: 'validation_failed',
      errorCategory: 'validation',
      safeMessage: `Invalid or missing source: '${source}'. Allowed sources: ${VALID_SOURCES.join(', ')}`,
      jobId: null,
      approvalId: null,
      dryrunId: null
    };
  }
  return null;
}

function checkPermission(command, actor) {
  const perm = requireCommandPermission(command, { chat: { id: actor } });
  return perm.allowed;
}

/**
 * Creates a runtime bot run.
 */
async function createRuntimeBotRun({ botSlug, request, actor, source, metadata }) {
  const sourceErr = validateSource(source);
  if (sourceErr) return sourceErr;

  if (!checkPermission('/run_bot', actor)) {
    return {
      ok: false,
      status: 'permission_denied',
      errorCategory: 'permission',
      safeMessage: `Access Denied: You do not have permission to execute run_bot.`,
      jobId: null,
      approvalId: null,
      dryrunId: null
    };
  }

  const jobId = generateRuntimeJobId();
  const res = await runBot(botSlug, request, actor, jobId);
  if (res.status !== 'success') {
    return {
      ok: false,
      status: res.status === 'unauthorized' ? 'permission_denied' : 'execution_failed',
      errorCategory: res.status === 'unauthorized' ? 'permission' : 'execution',
      safeMessage: res.message,
      jobId: null,
      approvalId: null,
      dryrunId: null
    };
  }

  return {
    ok: true,
    status: 'created',
    jobId,
    approvalId: null,
    dryrunId: null,
    filename: res.filename,
    driveLink: null,
    metadata: metadata || {}
  };
}

/**
 * Runs a preset bot execution.
 */
async function createRuntimePresetRun({ presetId, input, actor, source, metadata }) {
  const sourceErr = validateSource(source);
  if (sourceErr) return sourceErr;

  if (!checkPermission('/run_preset', actor)) {
    return {
      ok: false,
      status: 'permission_denied',
      errorCategory: 'permission',
      safeMessage: `Access Denied: You do not have permission to execute run_preset.`,
      jobId: null,
      approvalId: null,
      dryrunId: null
    };
  }

  const jobId = generateRuntimeJobId();
  const res = await runPreset(presetId, input, actor, { jobId });
  if (res.status !== 'success') {
    return {
      ok: false,
      status: res.status === 'unauthorized' ? 'permission_denied' : 'execution_failed',
      errorCategory: res.status === 'unauthorized' ? 'permission' : 'execution',
      safeMessage: res.message,
      jobId: null,
      approvalId: null,
      dryrunId: null
    };
  }

  return {
    ok: true,
    status: 'created',
    jobId,
    approvalId: null,
    dryrunId: null,
    filename: res.filename,
    driveLink: res.driveLink || null,
    metadata: metadata || {}
  };
}

/**
 * Creates a pending publish approval.
 */
async function createPublishApproval({ botSlug, request, actor, source, metadata }) {
  const sourceErr = validateSource(source);
  if (sourceErr) return sourceErr;

  if (!checkPermission('/run_publish', actor)) {
    return {
      ok: false,
      status: 'permission_denied',
      errorCategory: 'permission',
      safeMessage: `Access Denied: You do not have permission to request run_publish.`,
      jobId: null,
      approvalId: null,
      dryrunId: null
    };
  }

  const safePayload = {
    text: `/run_publish ${botSlug} ${request}`,
    message: {
      chat: { id: actor },
      from: { id: actor }
    }
  };

  try {
    const record = createApproval(actor, 'run_publish', 'publish', botSlug, null, request, safePayload);
    return {
      ok: true,
      status: 'created',
      jobId: null,
      approvalId: record.approvalId,
      dryrunId: null,
      filename: null,
      driveLink: null,
      metadata: metadata || {}
    };
  } catch (err) {
    return {
      ok: false,
      status: 'execution_failed',
      errorCategory: 'internal_error',
      safeMessage: `Failed to create publish approval: ${err.message}`,
      jobId: null,
      approvalId: null,
      dryrunId: null
    };
  }
}

/**
 * Creates a pending preset publish approval.
 */
async function createPresetPublishApproval({ presetId, input, actor, source, metadata }) {
  const sourceErr = validateSource(source);
  if (sourceErr) return sourceErr;

  if (!checkPermission('/run_preset_publish', actor)) {
    return {
      ok: false,
      status: 'permission_denied',
      errorCategory: 'permission',
      safeMessage: `Access Denied: You do not have permission to request run_preset_publish.`,
      jobId: null,
      approvalId: null,
      dryrunId: null
    };
  }

  const safePayload = {
    text: `/run_preset_publish ${presetId} ${input}`,
    message: {
      chat: { id: actor },
      from: { id: actor }
    }
  };

  try {
    const record = createApproval(actor, 'run_preset_publish', 'publish', null, presetId, input, safePayload);
    return {
      ok: true,
      status: 'created',
      jobId: null,
      approvalId: record.approvalId,
      dryrunId: null,
      filename: null,
      driveLink: null,
      metadata: metadata || {}
    };
  } catch (err) {
    return {
      ok: false,
      status: 'execution_failed',
      errorCategory: 'internal_error',
      safeMessage: `Failed to create preset publish approval: ${err.message}`,
      jobId: null,
      approvalId: null,
      dryrunId: null
    };
  }
}

/**
 * Creates a dry-run preview.
 */
async function createDryRun({ actionType, request, actor, source, metadata }) {
  const sourceErr = validateSource(source);
  if (sourceErr) return sourceErr;

  if (!checkPermission('/dryrun_action', actor)) {
    return {
      ok: false,
      status: 'permission_denied',
      errorCategory: 'permission',
      safeMessage: `Access Denied: You do not have permission to execute dryrun_action.`,
      jobId: null,
      approvalId: null,
      dryrunId: null
    };
  }

  const jobId = generateRuntimeJobId();
  try {
    const record = createDryRunPreview(actionType, request, { jobId, botSlug: 'tech-dryrun' });
    return {
      ok: true,
      status: 'created',
      jobId,
      approvalId: null,
      dryrunId: record.dryrunId,
      filename: record.filename,
      driveLink: null,
      metadata: metadata || {}
    };
  } catch (err) {
    return {
      ok: false,
      status: 'execution_failed',
      errorCategory: 'execution',
      safeMessage: err.message,
      jobId: null,
      approvalId: null,
      dryrunId: null
    };
  }
}

/**
 * Creates a pending dry-run publish approval.
 */
async function createDryRunPublishApproval({ actionType, request, actor, source, metadata }) {
  const sourceErr = validateSource(source);
  if (sourceErr) return sourceErr;

  if (!checkPermission('/dryrun_publish', actor)) {
    return {
      ok: false,
      status: 'permission_denied',
      errorCategory: 'permission',
      safeMessage: `Access Denied: You do not have permission to request dryrun_publish.`,
      jobId: null,
      approvalId: null,
      dryrunId: null
    };
  }

  const safePayload = {
    text: `/dryrun_publish ${actionType} ${request}`,
    message: {
      chat: { id: actor },
      from: { id: actor }
    }
  };

  try {
    const record = createApproval(actor, 'dryrun_publish', 'publish', null, null, `${actionType}: ${request}`, safePayload);
    return {
      ok: true,
      status: 'created',
      jobId: null,
      approvalId: record.approvalId,
      dryrunId: null,
      filename: null,
      driveLink: null,
      metadata: metadata || {}
    };
  } catch (err) {
    return {
      ok: false,
      status: 'execution_failed',
      errorCategory: 'internal_error',
      safeMessage: `Failed to create dryrun publish approval: ${err.message}`,
      jobId: null,
      approvalId: null,
      dryrunId: null
    };
  }
}

/**
 * Returns runtime job status.
 */
function getRuntimeJobStatus(jobId) {
  try {
    const status = getRuntimeJob(jobId);
    if (!status) {
      return {
        ok: false,
        status: 'not_found',
        errorCategory: 'validation',
        safeMessage: `Job with ID '${jobId}' not found.`,
        jobId: null,
        approvalId: null,
        dryrunId: null
      };
    }
    return {
      ok: true,
      status: status.status,
      jobId: status.jobId,
      filename: status.filename,
      driveLink: status.driveLink,
      metadata: {
        botSlug: status.botSlug,
        command: status.command,
        created: status.timestamp,
        published: status.published
      }
    };
  } catch (err) {
    return {
      ok: false,
      status: 'error',
      errorCategory: 'internal_error',
      safeMessage: err.message,
      jobId: null,
      approvalId: null,
      dryrunId: null
    };
  }
}

/**
 * Returns approval status.
 */
function getApprovalStatus(approvalId) {
  try {
    const record = getApproval(approvalId);
    if (!record) {
      return {
        ok: false,
        status: 'not_found',
        errorCategory: 'validation',
        safeMessage: `Approval record with ID '${approvalId}' not found.`,
        jobId: null,
        approvalId: null,
        dryrunId: null
      };
    }
    return {
      ok: true,
      status: record.status,
      approvalId: record.approvalId,
      jobId: record.resultJobId,
      filename: record.resultFilename,
      driveLink: record.driveLink,
      metadata: {
        command: record.command,
        botSlug: record.botSlug,
        presetId: record.presetId,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        safeMessage: record.safeMessage
      }
    };
  } catch (err) {
    return {
      ok: false,
      status: 'error',
      errorCategory: 'internal_error',
      safeMessage: err.message,
      jobId: null,
      approvalId: null,
      dryrunId: null
    };
  }
}

/**
 * Returns dry-run record status.
 */
function getDryRunStatus(dryrunId) {
  try {
    const record = getDryRunRecord(dryrunId);
    if (!record) {
      return {
        ok: false,
        status: 'not_found',
        errorCategory: 'validation',
        safeMessage: `Dry-run record with ID '${dryrunId}' not found.`,
        jobId: null,
        approvalId: null,
        dryrunId: null
      };
    }
    return {
      ok: true,
      status: record.status,
      dryrunId: record.dryrunId,
      jobId: record.jobId,
      filename: record.filename,
      driveLink: null,
      metadata: {
        actionType: record.actionType,
        validation: record.validation,
        createdAt: record.createdAt
      }
    };
  } catch (err) {
    return {
      ok: false,
      status: 'error',
      errorCategory: 'internal_error',
      safeMessage: err.message,
      jobId: null,
      approvalId: null,
      dryrunId: null
    };
  }
}

/**
 * Returns runtime system status summary.
 */
function getRuntimeSystemStatus() {
  try {
    const status = getRuntimeStatus();
    return {
      ok: true,
      status: status.status,
      metadata: status
    };
  } catch (err) {
    return {
      ok: false,
      status: 'error',
      errorCategory: 'internal_error',
      safeMessage: err.message,
      jobId: null,
      approvalId: null,
      dryrunId: null
    };
  }
}

module.exports = {
  createRuntimeBotRun,
  createRuntimePresetRun,
  createPublishApproval,
  createPresetPublishApproval,
  createDryRun,
  createDryRunPublishApproval,
  getRuntimeJobStatus,
  getApprovalStatus,
  getDryRunStatus,
  getRuntimeSystemStatus
};
