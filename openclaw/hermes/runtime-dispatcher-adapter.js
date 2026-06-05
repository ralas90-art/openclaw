const api = require('../runtime/runtime-orchestration-api');
const { validateJobData } = require('./hermes-job-schema');

/**
 * Prepares the payload for the Runtime Orchestration API from a Hermes job.
 * @param {object} hermesJob
 * @returns {object} The prepared payload including targetFunction.
 */
function prepareRuntimePayloadFromHermesJob(hermesJob) {
  if (!hermesJob) {
    throw new Error('Hermes job is missing.');
  }
  validateJobData(hermesJob);

  const metadata = {
    ...(hermesJob.metadata || {}),
    hermesJobId: hermesJob.hermesJobId
  };

  const payload = {
    actor: hermesJob.requestedBy,
    source: 'hermes',
    metadata
  };

  // Determine target endpoint and execution parameters based on metadata flags
  if (metadata.presetId) {
    payload.presetId = metadata.presetId;
    payload.input = hermesJob.inputSummary;
    payload.targetFunction = metadata.requiresPublish ? 'createPresetPublishApproval' : 'createRuntimePresetRun';
  } else if (metadata.actionType) {
    payload.actionType = metadata.actionType;
    payload.request = hermesJob.inputSummary;
    payload.targetFunction = metadata.requiresPublish ? 'createDryRunPublishApproval' : 'createDryRun';
  } else {
    payload.botSlug = hermesJob.botId;
    payload.request = hermesJob.inputSummary;
    payload.targetFunction = metadata.requiresPublish ? 'createPublishApproval' : 'createRuntimeBotRun';
  }

  return payload;
}

/**
 * Maps the status, errors, and output variables of the Runtime Orchestration response
 * back into the Hermes queue state.
 * @param {string} hermesJobId
 * @param {object} runtimeResponse
 * @returns {object} Updated Hermes job.
 */
function handleRuntimeDispatchResponse(hermesJobId, runtimeResponse) {
  if (!runtimeResponse) {
    return markHermesJobFailedFromRuntime(hermesJobId, {
      errorCategory: 'internal_error',
      safeMessage: 'Empty or invalid response received from Runtime Orchestration API.'
    });
  }

  if (runtimeResponse.ok === true) {
    if (runtimeResponse.approvalId) {
      return markHermesJobAwaitingApproval(hermesJobId, runtimeResponse);
    }
    return markHermesJobDispatched(hermesJobId, null, runtimeResponse);
  }

  // Handle errors / rejections
  const isPermission = runtimeResponse.errorCategory === 'permission' || runtimeResponse.status === 'permission_denied';
  if (isPermission) {
    return markHermesJobBlockedByRuntime(hermesJobId, runtimeResponse);
  }

  return markHermesJobFailedFromRuntime(hermesJobId, runtimeResponse);
}

/**
 * Transitions a job to 'awaiting_approval' and records the approvalId.
 * @param {string} hermesJobId
 * @param {object} approvalPayload
 * @returns {object} Updated job
 */
function markHermesJobAwaitingApproval(hermesJobId, approvalPayload) {
  const { updateHermesJobStatus } = require('./hermes-queue-engine');
  return updateHermesJobStatus(hermesJobId, 'awaiting_approval', {
    approvalId: approvalPayload.approvalId
  });
}

/**
 * Transitions a job to 'dispatched' and handles synchronous completion if applicable.
 * @param {string} hermesJobId
 * @param {object} runtimePayload
 * @param {object} runtimeResponse
 * @returns {object} Updated job
 */
function markHermesJobDispatched(hermesJobId, runtimePayload, runtimeResponse) {
  const { updateHermesJobStatus, completeHermesJob } = require('./hermes-queue-engine');
  
  // Transition status to 'dispatched' and store runtimeJobId in metadata
  let job = updateHermesJobStatus(hermesJobId, 'dispatched', {
    runtimeJobId: runtimeResponse.jobId
  });

  // If completed synchronously (API response has filename), transition to completed
  if (runtimeResponse.filename) {
    job = completeHermesJob(hermesJobId, {
      outputPath: runtimeResponse.filename,
      driveLink: runtimeResponse.driveLink,
      runtimeJobId: runtimeResponse.jobId
    });
  }

  return job;
}

/**
 * Transitions a job to 'blocked' due to Runtime validation/permission rejections.
 * @param {string} hermesJobId
 * @param {object} runtimeResponse
 * @returns {object} Updated job
 */
function markHermesJobBlockedByRuntime(hermesJobId, runtimeResponse) {
  const { blockHermesJob } = require('./hermes-queue-engine');
  const reason = runtimeResponse.safeMessage || 'Action blocked by Runtime authorization system.';
  
  const job = blockHermesJob(hermesJobId, reason);

  // Directly update database keys to preserve standardized error variables
  const { loadQueue, saveQueue } = require('./hermes-queue-store');
  const queue = loadQueue();
  if (queue[hermesJobId]) {
    queue[hermesJobId].errorCategory = runtimeResponse.errorCategory || 'permission';
    queue[hermesJobId].safeMessage = reason;
    saveQueue(queue);
    return queue[hermesJobId];
  }

  return job;
}

/**
 * Transitions a job to 'failed' due to Runtime execution failures.
 * @param {string} hermesJobId
 * @param {object} runtimeResponse
 * @returns {object} Updated job
 */
function markHermesJobFailedFromRuntime(hermesJobId, runtimeResponse) {
  const { failHermesJob } = require('./hermes-queue-engine');
  return failHermesJob(hermesJobId, {
    errorCategory: runtimeResponse.errorCategory || 'execution',
    safeMessage: runtimeResponse.safeMessage || 'Runtime execution failed.'
  });
}

/**
 * Main dispatch entry point. Prepares payload, calls runtime API, and updates queue state.
 * @param {string} hermesJobId
 * @param {object} [options]
 * @returns {Promise<object>} Updated Hermes job.
 */
async function dispatchHermesJobToRuntime(hermesJobId, options = {}) {
  const { readHermesJob, appendHermesJobEvent } = require('./hermes-queue-engine');
  
  const job = readHermesJob(hermesJobId);
  if (!job) {
    throw new Error(`Job not found for ID '${hermesJobId}'`);
  }

  appendHermesJobEvent(hermesJobId, 'Starting dispatch sequence to Bot Runtime.');

  let payload;
  try {
    payload = prepareRuntimePayloadFromHermesJob(job);
  } catch (err) {
    return markHermesJobFailedFromRuntime(hermesJobId, {
      errorCategory: 'validation',
      safeMessage: err.message
    });
  }

  const targetFn = payload.targetFunction;
  if (!api[targetFn]) {
    return markHermesJobFailedFromRuntime(hermesJobId, {
      errorCategory: 'internal_error',
      safeMessage: `Orchestration API function '${targetFn}' is not implemented.`
    });
  }

  try {
    // Execute call to frozen Runtime Orchestration API
    const res = await api[targetFn](payload);
    return handleRuntimeDispatchResponse(hermesJobId, res);
  } catch (err) {
    return markHermesJobFailedFromRuntime(hermesJobId, {
      errorCategory: 'internal_error',
      safeMessage: `Runtime Orchestration call crashed: ${err.message}`
    });
  }
}

module.exports = {
  dispatchHermesJobToRuntime,
  prepareRuntimePayloadFromHermesJob,
  handleRuntimeDispatchResponse,
  markHermesJobAwaitingApproval,
  markHermesJobDispatched,
  markHermesJobBlockedByRuntime,
  markHermesJobFailedFromRuntime
};
