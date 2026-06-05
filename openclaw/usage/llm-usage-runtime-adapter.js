/**
 * OpenClaw LLM Usage Runtime Adapter
 * Coordinates safe, non-blocking capture of LLM telemetry from Runtime bot runs.
 */

const usageLedger = require('./llm-usage-ledger');

/**
 * Estimates token counts using a safe heuristic (~4 characters per token).
 * @param {string} text
 * @returns {number}
 */
function estimateTokensFromText(text) {
  if (typeof text !== 'string') return 0;
  const cleaned = text.trim();
  if (!cleaned) return 0;
  return Math.ceil(cleaned.length / 4);
}

/**
 * Extracts token counts from a standard API response body.
 * @param {object} response
 * @returns {object|null} { inputTokens, outputTokens, totalTokens } or null
 */
function extractUsageFromProviderResponse(response) {
  if (!response) return null;
  
  let usage = null;
  if (response.usage) {
    usage = response.usage;
  } else if (response.data && response.data.usage) {
    usage = response.data.usage;
  }

  if (usage) {
    const inputTokens = usage.prompt_tokens || usage.input_tokens || usage.promptTokens || 0;
    const outputTokens = usage.completion_tokens || usage.output_tokens || usage.completionTokens || 0;
    const totalTokens = usage.total_tokens || usage.totalTokens || (inputTokens + outputTokens) || 0;
    return { inputTokens, outputTokens, totalTokens };
  }

  return null;
}

/**
 * Normalizes a raw runtime telemetry payload into a structured usage ledger entry.
 * Redacts prompts, secrets, and local paths.
 * @param {object} payload
 * @returns {object} Normalized usage entry.
 */
function normalizeRuntimeUsagePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Usage payload must be a valid object.');
  }

  const provider = payload.provider || 'unknown';
  const model = payload.model || 'unknown';
  const botId = payload.botId || 'unknown';
  const hermesJobId = payload.hermesJobId || null;
  const runtimeJobId = payload.runtimeJobId || null;

  let inputTokens = 0;
  let outputTokens = 0;
  let isEstimated = false;

  // 1. Determine tokens
  if (payload.usage && typeof payload.usage === 'object') {
    inputTokens = payload.usage.inputTokens || payload.usage.promptTokens || 0;
    outputTokens = payload.usage.outputTokens || payload.usage.completionTokens || 0;
  } else {
    // If usage is unavailable, estimate from text prompts and response
    const sysTokens = estimateTokensFromText(payload.systemPrompt || '');
    const userTokens = estimateTokensFromText(payload.userPrompt || '');
    inputTokens = sysTokens + userTokens;
    outputTokens = estimateTokensFromText(payload.responseContent || '');
    isEstimated = true;
  }

  // 2. Perform cost estimation
  const estimatedCostUsd = usageLedger.estimateCost(provider, model, inputTokens, outputTokens);

  // 3. Redact metadata keys
  const cleanMetadata = {};
  if (payload.metadata && typeof payload.metadata === 'object') {
    const redactedKeys = [
      'prompt', 'response', 'content', 'text', 'key', 'secret', 'token',
      'auth', 'password', 'path', 'stack', 'trace', 'file', 'payload'
    ];
    for (const [k, v] of Object.entries(payload.metadata)) {
      const lowerKey = k.toLowerCase();
      const shouldRedact = redactedKeys.some(r => lowerKey.includes(r));
      if (!shouldRedact) {
        if (typeof v === 'string') {
          // Redact paths or keys in values too
          const { sanitizeString } = require('../hermes/hermes-observability');
          cleanMetadata[k] = sanitizeString(v);
        } else {
          cleanMetadata[k] = v;
        }
      }
    }
  }

  return {
    provider,
    model,
    botId,
    hermesJobId,
    runtimeJobId,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd,
    isEstimated,
    createdAt: payload.createdAt || new Date().toISOString(),
    metadata: cleanMetadata
  };
}

/**
 * Safely records a runtime usage event. Guaranteed never to throw.
 * @param {object} event
 * @returns {object|null} The recorded entry, or null on failure.
 */
function safeRecordUsage(event) {
  try {
    const normalized = normalizeRuntimeUsagePayload(event);
    return usageLedger.recordUsage(normalized);
  } catch (err) {
    console.warn(`[llm-usage-runtime-adapter] safeRecordUsage warning (non-blocking): ${err.message}`);
    return null;
  }
}

module.exports = {
  estimateTokensFromText,
  extractUsageFromProviderResponse,
  normalizeRuntimeUsagePayload,
  safeRecordUsage
};
