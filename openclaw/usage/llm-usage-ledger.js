/**
 * OpenClaw LLM Usage Ledger Manager
 */

const { validateUsageEntry, sanitizeUsageEntry } = require('./llm-usage-schema');
const { loadLedger, saveLedger, getLedgerFilePath } = require('./llm-usage-store');

/**
 * Estimates the cost of LLM tokens based on provider and model rates per million.
 * @param {string} provider
 * @param {string} model
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @returns {number} Estimated cost in USD.
 */
function estimateCost(provider, model, inputTokens, outputTokens) {
  const p = (provider || '').toLowerCase();
  const m = (model || '').toLowerCase();
  
  let inputRate = 0.00000015; // default rate per token ($0.15 / 1M tokens)
  let outputRate = 0.00000060; // default rate per token ($0.60 / 1M tokens)
  
  if (m.includes('flash')) {
    inputRate = 0.000000075; // $0.075 / 1M
    outputRate = 0.00000030; // $0.30 / 1M
  } else if (m.includes('pro')) {
    inputRate = 0.00000125; // $1.25 / 1M
    outputRate = 0.00000500; // $5.00 / 1M
  } else if (m.includes('gpt-4o')) {
    inputRate = 0.00000500; // $5.00 / 1M
    outputRate = 0.00001500; // $15.00 / 1M
  } else if (m.includes('mock') || p.includes('mock')) {
    inputRate = 0;
    outputRate = 0;
  }
  
  return (inputTokens * inputRate) + (outputTokens * outputRate);
}

/**
 * Validates, sanitizes, and records an LLM usage entry.
 * @param {object} rawEntry
 * @returns {object} The recorded and sanitized entry.
 */
function recordUsage(rawEntry) {
  if (!rawEntry || typeof rawEntry !== 'object') {
    throw new Error('Invalid raw usage entry.');
  }

  const entry = { ...rawEntry };

  // Set default timestamp if missing
  if (!entry.createdAt) {
    entry.createdAt = new Date().toISOString();
  }

  // Set default total tokens if missing
  if (entry.totalTokens === undefined && entry.inputTokens !== undefined && entry.outputTokens !== undefined) {
    entry.totalTokens = entry.inputTokens + entry.outputTokens;
  }

  // Estimate cost if missing
  if (entry.estimatedCostUsd === undefined && entry.inputTokens !== undefined && entry.outputTokens !== undefined) {
    entry.estimatedCostUsd = estimateCost(entry.provider, entry.model, entry.inputTokens, entry.outputTokens);
  }

  // Validate before sanitizing to catch issues early
  validateUsageEntry(entry);

  const sanitized = sanitizeUsageEntry(entry);

  const ledger = loadLedger();
  ledger.push(sanitized);
  saveLedger(ledger);

  return sanitized;
}

/**
 * Generates an aggregated summary of LLM token counts and costs.
 * @returns {object}
 */
function getUsageSummary() {
  const ledger = loadLedger();
  
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;
  let totalCostUsd = 0;
  
  const byBot = {};
  const byModel = {};

  for (const entry of ledger) {
    totalInputTokens += entry.inputTokens;
    totalOutputTokens += entry.outputTokens;
    totalTokens += entry.totalTokens;
    totalCostUsd += entry.estimatedCostUsd;

    // Aggregate by botId
    const bot = entry.botId;
    if (!byBot[bot]) {
      byBot[bot] = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, count: 0 };
    }
    byBot[bot].inputTokens += entry.inputTokens;
    byBot[bot].outputTokens += entry.outputTokens;
    byBot[bot].totalTokens += entry.totalTokens;
    byBot[bot].costUsd += entry.estimatedCostUsd;
    byBot[bot].count += 1;

    // Aggregate by model
    const model = entry.model;
    if (!byModel[model]) {
      byModel[model] = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, count: 0 };
    }
    byModel[model].inputTokens += entry.inputTokens;
    byModel[model].outputTokens += entry.outputTokens;
    byModel[model].totalTokens += entry.totalTokens;
    byModel[model].costUsd += entry.estimatedCostUsd;
    byModel[model].count += 1;
  }

  return {
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    totalCostUsd,
    byBot,
    byModel,
    entryCount: ledger.length
  };
}

/**
 * Lists usage ledger entries, matching filters. Sorted latest first.
 * @param {object} filters
 * @returns {object[]}
 */
function listUsageEntries(filters = {}) {
  const ledger = loadLedger();
  let results = [...ledger];

  if (filters.botId) {
    const f = filters.botId.toLowerCase();
    results = results.filter(e => e.botId && e.botId.toLowerCase() === f);
  }
  if (filters.provider) {
    const f = filters.provider.toLowerCase();
    results = results.filter(e => e.provider && e.provider.toLowerCase() === f);
  }
  if (filters.model) {
    const f = filters.model.toLowerCase();
    results = results.filter(e => e.model && e.model.toLowerCase() === f);
  }
  if (filters.hermesJobId) {
    const f = filters.hermesJobId.toLowerCase();
    results = results.filter(e => e.hermesJobId && e.hermesJobId.toLowerCase() === f);
  }
  if (filters.runtimeJobId) {
    const f = filters.runtimeJobId.toLowerCase();
    results = results.filter(e => e.runtimeJobId && e.runtimeJobId.toLowerCase() === f);
  }
  if (filters.project) {
    const f = filters.project.toLowerCase();
    results = results.filter(e => e.project && e.project.toLowerCase().includes(f));
  }

  // Sort descending by creation timestamp
  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

module.exports = {
  recordUsage,
  getUsageSummary,
  listUsageEntries,
  getLedgerFilePath,
  estimateCost
};
