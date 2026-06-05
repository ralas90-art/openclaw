/**
 * OpenClaw Hermes Duplicate Detection
 */

const { loadQueue } = require('./hermes-queue-store');
const { hashInput } = require('./hermes-job-schema');

const ACTIVE_STATUSES = [
  'queued',
  'triaged',
  'awaiting_approval',
  'approved',
  'dispatched',
  'running'
];

/**
 * Searches the queue for a duplicate active job.
 * Matches on: requestedBy, botId, inputHash and active status window.
 * @param {string|number} requestedBy
 * @param {string} botId
 * @param {string} inputSummaryOrHash
 * @returns {object|null} The active duplicate job, or null if none exists.
 */
function findDuplicateActiveJob(requestedBy, botId, inputSummaryOrHash) {
  const queue = loadQueue();
  const jobs = Object.values(queue);
  
  const actor = String(requestedBy).trim();
  const targetBot = String(botId).trim().toLowerCase();
  
  // Resolve input hash
  const hash = (typeof inputSummaryOrHash === 'string' && inputSummaryOrHash.length === 64 && /^[0-9a-fA-F]+$/.test(inputSummaryOrHash))
    ? inputSummaryOrHash
    : hashInput(inputSummaryOrHash);

  return jobs.find(job => {
    return (
      String(job.requestedBy).trim() === actor &&
      job.botId.toLowerCase() === targetBot &&
      job.inputHash === hash &&
      ACTIVE_STATUSES.includes(job.status)
    );
  }) || null;
}

module.exports = {
  ACTIVE_STATUSES,
  findDuplicateActiveJob
};
