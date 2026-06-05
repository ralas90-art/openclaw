/**
 * OpenClaw Hermes Search and Query Filters
 */

const store = require('./hermes-queue-store');
const { sanitizeHermesObservableJob } = require('./hermes-observability');

/**
 * Normalizes sorting and pagination options.
 */
function _applyOptions(jobs, options = {}) {
  const limit = typeof options.limit === 'number' ? options.limit : 20;
  const sort = options.sort === 'asc' ? 'asc' : 'desc';
  const sortBy = options.sortBy || 'updatedAt';

  // Sort
  jobs.sort((a, b) => {
    const valA = a[sortBy] || '';
    const valB = b[sortBy] || '';
    return sort === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
  });

  // Limit
  return jobs.slice(0, limit);
}

/**
 * Searches jobs matching query case-insensitively across searchable fields.
 * Returns cloned, sanitized records.
 * @param {string} query Search keyword
 * @param {object} [options] limit, sort, sortBy
 * @returns {object[]}
 */
function searchHermesJobs(query, options = {}) {
  const queue = store.loadQueue();
  let jobs = Object.values(queue);

  if (query && typeof query === 'string' && query.trim() !== '') {
    const normalized = query.trim().toLowerCase();
    jobs = jobs.filter(job => {
      const matchFields = [
        job.hermesJobId,
        job.runtimeJobId,
        job.botId,
        job.requestedBy,
        job.inputSummary,
        job.approvalId,
        job.errorCategory
      ];
      return matchFields.some(f => f && String(f).toLowerCase().includes(normalized));
    });
  }

  const processed = _applyOptions(jobs, options);
  return processed.map(sanitizeHermesObservableJob);
}

/**
 * Filters jobs by exact or case-insensitive matching fields and date ranges.
 * @param {object} filters Filter conditions
 * @param {object} [options] limit, sort, sortBy
 * @returns {object[]}
 */
function filterHermesJobs(filters = {}, options = {}) {
  const queue = store.loadQueue();
  let jobs = Object.values(queue);

  if (filters.status) {
    jobs = jobs.filter(j => j.status === filters.status);
  }
  if (filters.botId) {
    const target = filters.botId.toLowerCase();
    jobs = jobs.filter(j => j.botId && j.botId.toLowerCase() === target);
  }
  if (filters.requestedBy) {
    const target = String(filters.requestedBy).trim();
    jobs = jobs.filter(j => j.requestedBy && String(j.requestedBy).trim() === target);
  }
  if (filters.runtimeJobId) {
    jobs = jobs.filter(j => j.runtimeJobId === filters.runtimeJobId);
  }
  if (filters.approvalId) {
    jobs = jobs.filter(j => j.approvalId === filters.approvalId);
  }
  if (filters.errorCategory) {
    jobs = jobs.filter(j => j.errorCategory === filters.errorCategory);
  }
  if (filters.priority) {
    jobs = jobs.filter(j => j.priority === filters.priority);
  }

  // Date ranges (compares against createdAt)
  if (filters.startDate) {
    const start = new Date(filters.startDate).getTime();
    jobs = jobs.filter(j => {
      const created = new Date(j.createdAt).getTime();
      return !isNaN(created) && !isNaN(start) && created >= start;
    });
  }
  if (filters.endDate) {
    const end = new Date(filters.endDate).getTime();
    jobs = jobs.filter(j => {
      const created = new Date(j.createdAt).getTime();
      return !isNaN(created) && !isNaN(end) && created <= end;
    });
  }

  const processed = _applyOptions(jobs, options);
  return processed.map(sanitizeHermesObservableJob);
}

// ------------------------------------------
// Quick Filter Helpers
// ------------------------------------------

function findJobsByStatus(status, options = {}) {
  return filterHermesJobs({ status }, options);
}

function findJobsByBotId(botId, options = {}) {
  return filterHermesJobs({ botId }, options);
}

function findJobsByRequestedBy(requestedBy, options = {}) {
  return filterHermesJobs({ requestedBy }, options);
}

function findJobsByRuntimeJobId(runtimeJobId, options = {}) {
  return filterHermesJobs({ runtimeJobId }, options);
}

function findJobsByApprovalId(approvalId, options = {}) {
  return filterHermesJobs({ approvalId }, options);
}

function findJobsByErrorCategory(errorCategory, options = {}) {
  return filterHermesJobs({ errorCategory }, options);
}

function findJobsByPriority(priority, options = {}) {
  return filterHermesJobs({ priority }, options);
}

function findJobsByDateRange(startDate, endDate, options = {}) {
  return filterHermesJobs({ startDate, endDate }, options);
}

function findActiveHermesJobs(options = {}) {
  const queue = store.loadQueue();
  const activeStatuses = ['queued', 'triaged', 'awaiting_approval', 'approved', 'dispatched', 'running'];
  const jobs = Object.values(queue).filter(j => activeStatuses.includes(j.status));
  const processed = _applyOptions(jobs, options);
  return processed.map(sanitizeHermesObservableJob);
}

function findFailedHermesJobs(options = {}) {
  return findJobsByStatus('failed', options);
}

function findApprovalPendingHermesJobs(options = {}) {
  return findJobsByStatus('awaiting_approval', options);
}

function findCompletedHermesJobs(options = {}) {
  return findJobsByStatus('completed', options);
}

function findBlockedHermesJobs(options = {}) {
  return findJobsByStatus('blocked', options);
}

module.exports = {
  searchHermesJobs,
  filterHermesJobs,
  findJobsByStatus,
  findJobsByBotId,
  findJobsByRequestedBy,
  findJobsByRuntimeJobId,
  findJobsByApprovalId,
  findJobsByErrorCategory,
  findJobsByPriority,
  findJobsByDateRange,
  findActiveHermesJobs,
  findFailedHermesJobs,
  findApprovalPendingHermesJobs,
  findCompletedHermesJobs,
  findBlockedHermesJobs
};
