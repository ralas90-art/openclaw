/**
 * OpenClaw Hermes Job Schema and Validation
 */

const crypto = require('crypto');

const VALID_STATUSES = [
  'queued',
  'triaged',
  'awaiting_approval',
  'approved',
  'dispatched',
  'running',
  'completed',
  'failed',
  'canceled',
  'blocked'
];

const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const VALID_SOURCES = ['telegram', 'hermes', 'test', 'system'];

/**
 * Generates a unique Hermes Job ID matching format: hm_YYYYMMDD_HHMMSS_<rand>
 */
function generateHermesJobId() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const timestamp = `${year}${month}${day}_${hours}${minutes}${seconds}`;
  const rand = crypto.randomBytes(3).toString('hex');
  return `hm_${timestamp}_${rand}`;
}

/**
 * Generates a deterministic SHA-256 hash of the input string for duplicate matching.
 */
function hashInput(inputSummary) {
  const normalized = typeof inputSummary === 'string' ? inputSummary.trim() : '';
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Validates raw job properties. Throws on validation error.
 */
function validateJobData(data) {
  if (!data) {
    throw new Error('Validation Error: Job data is empty.');
  }
  if (!data.requestedBy) {
    throw new Error('Validation Error: requestedBy is required.');
  }
  if (!data.botId) {
    throw new Error('Validation Error: botId is required.');
  }
  
  if (data.source && !VALID_SOURCES.includes(data.source)) {
    throw new Error(`Validation Error: Invalid source '${data.source}'. Valid options: ${VALID_SOURCES.join(', ')}`);
  }
  if (data.status && !VALID_STATUSES.includes(data.status)) {
    throw new Error(`Validation Error: Invalid status '${data.status}'. Valid options: ${VALID_STATUSES.join(', ')}`);
  }
  if (data.priority && !VALID_PRIORITIES.includes(data.priority)) {
    throw new Error(`Validation Error: Invalid priority '${data.priority}'. Valid options: ${VALID_PRIORITIES.join(', ')}`);
  }
}

/**
 * Assembles a valid HermesQueueJob structure with defaults.
 */
function buildJob(data) {
  validateJobData(data);
  const inputSummary = data.inputSummary || '';
  const now = new Date().toISOString();
  
  return {
    hermesJobId: data.hermesJobId || generateHermesJobId(),
    runtimeJobId: data.runtimeJobId || null,
    source: data.source || 'telegram',
    requestedBy: String(data.requestedBy).trim(),
    botId: String(data.botId).trim(),
    priority: data.priority || 'normal',
    status: data.status || 'queued',
    approvalId: data.approvalId || null,
    inputSummary: inputSummary,
    inputHash: hashInput(inputSummary),
    outputPath: data.outputPath || null,
    driveLink: data.driveLink || null,
    errorCategory: data.errorCategory || null,
    safeMessage: data.safeMessage || null,
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
    metadata: data.metadata || {},
    events: data.events || []
  };
}

module.exports = {
  VALID_STATUSES,
  VALID_PRIORITIES,
  VALID_SOURCES,
  generateHermesJobId,
  hashInput,
  validateJobData,
  buildJob
};
