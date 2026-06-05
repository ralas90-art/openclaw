/**
 * OpenClaw LLM Usage Analytics Engine
 * Coordinates monthly, daily, and breakdown statistics for the dashboard.
 */

const ledger = require('./llm-usage-ledger');

/**
 * Returns a list of usage entries filtered by custom search filters and date ranges.
 * @param {object} filters
 * @returns {object[]}
 */
function getFilteredEntries(filters = {}) {
  let results = ledger.listUsageEntries(filters);

  // Apply date range filters
  if (filters.startDate) {
    results = results.filter(e => e.createdAt >= filters.startDate);
  }
  if (filters.endDate) {
    let endBound = filters.endDate;
    if (endBound.length === 10) {
      endBound = `${endBound}T23:59:59.999Z`;
    }
    results = results.filter(e => e.createdAt <= endBound);
  }

  return results;
}

/**
 * Aggregates token counts, estimated costs, and entry counts based on filters.
 * @param {object} filters
 * @returns {object} Aggregated summary metrics.
 */
function buildUsageSummary(filters = {}) {
  const entries = getFilteredEntries(filters);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;
  let totalCostUsd = 0;

  for (const entry of entries) {
    totalInputTokens += entry.inputTokens || 0;
    totalOutputTokens += entry.outputTokens || 0;
    totalTokens += entry.totalTokens || 0;
    totalCostUsd += entry.estimatedCostUsd || 0;
  }

  return {
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    totalCostUsd,
    entryCount: entries.length
  };
}

/**
 * Builds the usage summary for a specific calendar date (YYYY-MM-DD).
 * @param {string} date
 * @returns {object}
 */
function buildDailyUsageSummary(date) {
  if (!date) return buildUsageSummary({ startDate: '1970-01-01' });
  
  // Match prefix
  return buildUsageSummary({
    startDate: `${date}T00:00:00.000Z`,
    endDate: `${date}T23:59:59.999Z`
  });
}

/**
 * Builds the usage summary for a specific calendar month (year, month).
 * @param {number|string} year
 * @param {number|string} month
 * @returns {object}
 */
function buildMonthlyUsageSummary(year, month) {
  const yStr = String(year);
  const mStr = String(month).padStart(2, '0');
  const monthPrefix = `${yStr}-${mStr}`;
  
  return buildUsageSummary({
    startDate: `${monthPrefix}-01T00:00:00.000Z`,
    endDate: `${monthPrefix}-31T23:59:59.999Z` // date filter will safely cover up to end of month
  });
}

/**
 * Groups metrics by provider.
 * @param {object} filters
 * @returns {object[]} Grouped provider list sorted by cost descending.
 */
function buildProviderUsageBreakdown(filters = {}) {
  const entries = getFilteredEntries(filters);
  const totalCost = entries.reduce((acc, e) => acc + (e.estimatedCostUsd || 0), 0);
  const grouped = {};

  for (const entry of entries) {
    const key = entry.provider || 'unknown';
    if (!grouped[key]) {
      grouped[key] = { provider: key, count: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };
    }
    grouped[key].count++;
    grouped[key].inputTokens += entry.inputTokens || 0;
    grouped[key].outputTokens += entry.outputTokens || 0;
    grouped[key].totalTokens += entry.totalTokens || 0;
    grouped[key].costUsd += entry.estimatedCostUsd || 0;
  }

  return Object.values(grouped).map(item => {
    item.percent = totalCost > 0 ? parseFloat(((item.costUsd / totalCost) * 100).toFixed(2)) : 0;
    return item;
  }).sort((a, b) => b.costUsd - a.costUsd);
}

/**
 * Groups metrics by model name.
 * @param {object} filters
 * @returns {object[]} Grouped model list sorted by cost descending.
 */
function buildModelUsageBreakdown(filters = {}) {
  const entries = getFilteredEntries(filters);
  const totalCost = entries.reduce((acc, e) => acc + (e.estimatedCostUsd || 0), 0);
  const grouped = {};

  for (const entry of entries) {
    const key = entry.model || 'unknown';
    if (!grouped[key]) {
      grouped[key] = { model: key, count: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };
    }
    grouped[key].count++;
    grouped[key].inputTokens += entry.inputTokens || 0;
    grouped[key].outputTokens += entry.outputTokens || 0;
    grouped[key].totalTokens += entry.totalTokens || 0;
    grouped[key].costUsd += entry.estimatedCostUsd || 0;
  }

  return Object.values(grouped).map(item => {
    item.percent = totalCost > 0 ? parseFloat(((item.costUsd / totalCost) * 100).toFixed(2)) : 0;
    return item;
  }).sort((a, b) => b.costUsd - a.costUsd);
}

/**
 * Groups metrics by bot slug.
 * @param {object} filters
 * @returns {object[]} Grouped bot list sorted by cost descending.
 */
function buildBotUsageBreakdown(filters = {}) {
  const entries = getFilteredEntries(filters);
  const totalCost = entries.reduce((acc, e) => acc + (e.estimatedCostUsd || 0), 0);
  const grouped = {};

  for (const entry of entries) {
    const key = entry.botId || 'unknown';
    if (!grouped[key]) {
      grouped[key] = { botId: key, count: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };
    }
    grouped[key].count++;
    grouped[key].inputTokens += entry.inputTokens || 0;
    grouped[key].outputTokens += entry.outputTokens || 0;
    grouped[key].totalTokens += entry.totalTokens || 0;
    grouped[key].costUsd += entry.estimatedCostUsd || 0;
  }

  return Object.values(grouped).map(item => {
    item.percent = totalCost > 0 ? parseFloat(((item.costUsd / totalCost) * 100).toFixed(2)) : 0;
    return item;
  }).sort((a, b) => b.costUsd - a.costUsd);
}

/**
 * Groups metrics by Hermes job ID / Runtime job ID.
 * @param {object} filters
 * @returns {object[]} Grouped job list sorted by cost descending.
 */
function buildJobUsageBreakdown(filters = {}) {
  const entries = getFilteredEntries(filters);
  const grouped = {};

  for (const entry of entries) {
    const jobId = entry.hermesJobId || entry.runtimeJobId || 'untracked';
    if (!grouped[jobId]) {
      grouped[jobId] = {
        jobId,
        hermesJobId: entry.hermesJobId || null,
        runtimeJobId: entry.runtimeJobId || null,
        botId: entry.botId,
        count: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        createdAt: entry.createdAt
      };
    }
    grouped[jobId].count++;
    grouped[jobId].inputTokens += entry.inputTokens || 0;
    grouped[jobId].outputTokens += entry.outputTokens || 0;
    grouped[jobId].totalTokens += entry.totalTokens || 0;
    grouped[jobId].costUsd += entry.estimatedCostUsd || 0;
    if (entry.createdAt > grouped[jobId].createdAt) {
      grouped[jobId].createdAt = entry.createdAt;
    }
  }

  return Object.values(grouped).sort((a, b) => b.costUsd - a.costUsd);
}

/**
 * Calculates estimated-vs-actual token and cost metrics.
 * @param {object} filters
 * @returns {object}
 */
function buildEstimatedVsActualUsage(filters = {}) {
  const entries = getFilteredEntries(filters);
  const totalCost = entries.reduce((acc, e) => acc + (e.estimatedCostUsd || 0), 0);
  const totalTokens = entries.reduce((acc, e) => acc + (e.totalTokens || 0), 0);

  const stats = {
    estimated: { count: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, costPercent: 0, tokenPercent: 0 },
    actual: { count: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, costPercent: 0, tokenPercent: 0 }
  };

  for (const entry of entries) {
    const category = entry.isEstimated ? 'estimated' : 'actual';
    stats[category].count++;
    stats[category].inputTokens += entry.inputTokens || 0;
    stats[category].outputTokens += entry.outputTokens || 0;
    stats[category].totalTokens += entry.totalTokens || 0;
    stats[category].costUsd += entry.estimatedCostUsd || 0;
  }

  stats.estimated.costPercent = totalCost > 0 ? parseFloat(((stats.estimated.costUsd / totalCost) * 100).toFixed(2)) : 0;
  stats.estimated.tokenPercent = totalTokens > 0 ? parseFloat(((stats.estimated.totalTokens / totalTokens) * 100).toFixed(2)) : 0;
  stats.actual.costPercent = totalCost > 0 ? parseFloat(((stats.actual.costUsd / totalCost) * 100).toFixed(2)) : 0;
  stats.actual.tokenPercent = totalTokens > 0 ? parseFloat(((stats.actual.totalTokens / totalTokens) * 100).toFixed(2)) : 0;

  return stats;
}

/**
 * Determines monthly budget threshold warning status.
 * @param {object} filters
 * @param {number} [budgetLimit] Custom budget threshold in USD
 * @returns {object} Budget warnings metrics.
 */
function buildBudgetWarningSummary(filters = {}, budgetLimit = null) {
  let limit = budgetLimit;
  if (limit === null || limit === undefined) {
    const envVal = process.env.HERMES_MONTHLY_USAGE_BUDGET_USD;
    limit = envVal ? parseFloat(envVal) : 100.0;
  }

  if (isNaN(limit) || limit < 0) {
    limit = 100.0;
  }

  const entries = getFilteredEntries(filters);
  const currentCostUsd = entries.reduce((acc, e) => acc + (e.estimatedCostUsd || 0), 0);
  const exceeded = currentCostUsd > limit;
  let warningMessage = null;

  if (exceeded) {
    warningMessage = `⚠️ WARNING: Monthly usage cost of $${currentCostUsd.toFixed(5)} has exceeded the configured budget threshold of $${limit.toFixed(2)}.`;
  }

  return {
    budgetUsd: limit,
    currentCostUsd,
    exceeded,
    warningMessage
  };
}

module.exports = {
  getFilteredEntries,
  buildUsageSummary,
  buildDailyUsageSummary,
  buildMonthlyUsageSummary,
  buildProviderUsageBreakdown,
  buildModelUsageBreakdown,
  buildBotUsageBreakdown,
  buildJobUsageBreakdown,
  buildEstimatedVsActualUsage,
  buildBudgetWarningSummary
};
