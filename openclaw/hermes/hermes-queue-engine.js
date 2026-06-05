/**
 * OpenClaw Hermes Queue Engine API
 */

const { loadQueue, saveQueue } = require('./hermes-queue-store');
const { buildJob, VALID_STATUSES } = require('./hermes-job-schema');
const { findDuplicateActiveJob } = require('./hermes-dedupe');

/**
 * Appends a log event to a job's events list.
 * Internal helper.
 */
function _appendEventInternal(job, message) {
  const timestamp = new Date().toISOString();
  job.events.push({
    timestamp,
    message
  });
  job.updatedAt = timestamp;
}

/**
 * Creates a new Hermes job. Checks for duplicates unless force: true is passed.
 * @param {object} input
 * @returns {object} The created job.
 */
function createHermesJob(input) {
  if (!input) {
    throw new Error('Input payload is missing.');
  }

  const force = !!input.force;
  
  if (!force) {
    const duplicate = findDuplicateActiveJob(input.requestedBy, input.botId, input.inputSummary);
    if (duplicate) {
      throw new Error('Active duplicate job already exists.');
    }
  }

  const job = buildJob(input);
  _appendEventInternal(job, 'Job initialized and queued.');

  const queue = loadQueue();
  queue[job.hermesJobId] = job;
  saveQueue(queue);

  return job;
}

/**
 * Retrieves a single job by its Hermes Job ID.
 * @param {string} hermesJobId
 * @returns {object|null}
 */
function readHermesJob(hermesJobId) {
  if (!hermesJobId) return null;
  const queue = loadQueue();
  return queue[hermesJobId] || null;
}

/**
 * Lists all jobs, optionally filtering by status, botId, or requestedBy.
 * @param {object} filters
 * @returns {object[]}
 */
function listHermesJobs(filters = {}) {
  const queue = loadQueue();
  let jobs = Object.values(queue);

  if (filters.status) {
    jobs = jobs.filter(j => j.status === filters.status);
  }
  if (filters.botId) {
    const targetBot = filters.botId.toLowerCase();
    jobs = jobs.filter(j => j.botId.toLowerCase() === targetBot);
  }
  if (filters.requestedBy) {
    const actorStr = String(filters.requestedBy).trim();
    jobs = jobs.filter(j => String(j.requestedBy).trim() === actorStr);
  }

  return jobs;
}

/**
 * Updates a job's status and merges metadata.
 * @param {string} hermesJobId
 * @param {string} status
 * @param {object} [metadata]
 * @returns {object} Updated job
 */
function updateHermesJobStatus(hermesJobId, status, metadata = {}) {
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid status '${status}'. Valid statuses: ${VALID_STATUSES.join(', ')}`);
  }

  const queue = loadQueue();
  const job = queue[hermesJobId];
  if (!job) {
    throw new Error(`Job not found for ID '${hermesJobId}'`);
  }

  const oldStatus = job.status;
  job.status = status;
  
  if (metadata && typeof metadata === 'object') {
    if (metadata.approvalId) {
      job.approvalId = metadata.approvalId;
    }
    if (metadata.runtimeJobId) {
      job.runtimeJobId = metadata.runtimeJobId;
    }
    job.metadata = { ...job.metadata, ...metadata };
  }

  _appendEventInternal(job, `Status transitioned from '${oldStatus}' to '${status}'.`);
  saveQueue(queue);

  return job;
}

/**
 * Appends a custom trace log event to a job's history list.
 * @param {string} hermesJobId
 * @param {string} eventMessage
 * @returns {object} Updated job
 */
function appendHermesJobEvent(hermesJobId, eventMessage) {
  if (!eventMessage) {
    throw new Error('Event message is required.');
  }

  const queue = loadQueue();
  const job = queue[hermesJobId];
  if (!job) {
    throw new Error(`Job not found for ID '${hermesJobId}'`);
  }

  _appendEventInternal(job, eventMessage);
  saveQueue(queue);

  return job;
}

/**
 * Returns the latest job matching the filters, sorted descending by creation time.
 * @param {object} filters
 * @returns {object|null}
 */
function findLatestHermesJob(filters = {}) {
  const jobs = listHermesJobs(filters);
  if (jobs.length === 0) return null;
  // Sort descending by creation timestamp or lexicographical Job ID
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/**
 * Checks for a duplicate active job.
 * @param {object} input
 * @returns {object|null}
 */
function findDuplicateHermesJob(input) {
  if (!input) return null;
  return findDuplicateActiveJob(input.requestedBy, input.botId, input.inputSummary);
}

/**
 * Transitions a job to 'canceled' status.
 * @param {string} hermesJobId
 * @param {string} [reason]
 * @returns {object}
 */
function cancelHermesJob(hermesJobId, reason = 'Operator canceled execution') {
  const queue = loadQueue();
  const job = queue[hermesJobId];
  if (!job) {
    throw new Error(`Job not found for ID '${hermesJobId}'`);
  }

  job.status = 'canceled';
  _appendEventInternal(job, `Job canceled. Reason: ${reason}`);
  saveQueue(queue);

  return job;
}

/**
 * Transitions a job to 'blocked' status.
 * @param {string} hermesJobId
 * @param {string} [reason]
 * @returns {object}
 */
function blockHermesJob(hermesJobId, reason = 'Action blocked') {
  const queue = loadQueue();
  const job = queue[hermesJobId];
  if (!job) {
    throw new Error(`Job not found for ID '${hermesJobId}'`);
  }

  job.status = 'blocked';
  _appendEventInternal(job, `Job blocked. Reason: ${reason}`);
  saveQueue(queue);

  return job;
}

/**
 * Transitions a job to 'failed' status and logs error categories.
 * @param {string} hermesJobId
 * @param {object} errorPayload
 * @returns {object}
 */
function failHermesJob(hermesJobId, errorPayload = {}) {
  const queue = loadQueue();
  const job = queue[hermesJobId];
  if (!job) {
    throw new Error(`Job not found for ID '${hermesJobId}'`);
  }

  job.status = 'failed';
  job.errorCategory = errorPayload.errorCategory || 'internal_error';
  job.safeMessage = errorPayload.safeMessage || 'An unknown error occurred during queue execution.';
  
  _appendEventInternal(job, `Job execution failed. Category: ${job.errorCategory}. Error: ${job.safeMessage}`);
  saveQueue(queue);

  return job;
}

/**
 * Transitions a job to 'completed' status and records output parameters.
 * @param {string} hermesJobId
 * @param {object} resultPayload
 * @returns {object}
 */
function completeHermesJob(hermesJobId, resultPayload = {}) {
  const queue = loadQueue();
  const job = queue[hermesJobId];
  if (!job) {
    throw new Error(`Job not found for ID '${hermesJobId}'`);
  }

  job.status = 'completed';
  if (resultPayload.outputPath) job.outputPath = resultPayload.outputPath;
  if (resultPayload.driveLink) job.driveLink = resultPayload.driveLink;
  if (resultPayload.runtimeJobId) job.runtimeJobId = resultPayload.runtimeJobId;

  _appendEventInternal(job, 'Job execution completed successfully.');
  saveQueue(queue);

  return job;
}

module.exports = {
  createHermesJob,
  readHermesJob,
  listHermesJobs,
  updateHermesJobStatus,
  appendHermesJobEvent,
  findLatestHermesJob,
  findDuplicateHermesJob,
  cancelHermesJob,
  blockHermesJob,
  failHermesJob,
  completeHermesJob
};
