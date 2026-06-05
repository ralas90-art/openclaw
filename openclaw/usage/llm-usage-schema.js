/**
 * OpenClaw LLM Usage Schema & Sanitization
 */

/**
 * Validates a usage ledger entry.
 * @param {object} entry
 * @returns {void} Throws an error if invalid.
 */
function validateUsageEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('Usage entry must be a valid object.');
  }

  const requiredStrings = ['provider', 'model', 'botId', 'createdAt'];
  for (const field of requiredStrings) {
    if (!entry[field] || typeof entry[field] !== 'string' || !entry[field].trim()) {
      throw new Error(`Usage entry field '${field}' must be a non-empty string.`);
    }
  }

  const requiredNumbers = ['inputTokens', 'outputTokens', 'totalTokens', 'estimatedCostUsd'];
  for (const field of requiredNumbers) {
    if (typeof entry[field] !== 'number' || isNaN(entry[field]) || entry[field] < 0) {
      throw new Error(`Usage entry field '${field}' must be a non-negative number.`);
    }
  }

  // Validate ISO 8601 Date
  const dateParsed = Date.parse(entry.createdAt);
  if (isNaN(dateParsed)) {
    throw new Error("Usage entry field 'createdAt' must be a valid ISO 8601 date string.");
  }

  // Validate optional structures
  if (entry.metadata !== undefined && (typeof entry.metadata !== 'object' || entry.metadata === null)) {
    throw new Error("Usage entry field 'metadata' must be an object.");
  }
}

/**
 * Clones and sanitizes a usage entry to ensure no raw prompts, responses, or API keys are stored.
 * @param {object} entry
 * @returns {object} Sanitized clone.
 */
function sanitizeUsageEntry(entry) {
  if (!entry) return {};
  
  // Deep clone using simple JSON serialization/deserialization to break references
  const clone = JSON.parse(JSON.stringify(entry));

  // Redacted keywords for keys in metadata
  const redactedKeys = [
    'prompt', 'text', 'response', 'input', 'output', 'body', 'payload', 'msg',
    'api_key', 'apikey', 'key', 'token', 'secret', 'credential', 'auth', 'password'
  ];

  if (clone.metadata && typeof clone.metadata === 'object') {
    const keys = Object.keys(clone.metadata);
    for (const key of keys) {
      const lowerKey = key.toLowerCase();
      const shouldRedact = redactedKeys.some(r => lowerKey.includes(r));
      if (shouldRedact) {
        delete clone.metadata[key];
      }
    }
  }

  // Ensure prompt or key fields are not sneaked onto the root object
  const rootKeys = Object.keys(clone);
  const allowedRootKeys = [
    'provider', 'model', 'hermesJobId', 'runtimeJobId', 'botId',
    'project', 'inputTokens', 'outputTokens', 'totalTokens',
    'estimatedCostUsd', 'isEstimated', 'createdAt', 'metadata'
  ];

  for (const key of rootKeys) {
    if (!allowedRootKeys.includes(key)) {
      delete clone[key];
    }
  }

  return clone;
}

module.exports = {
  validateUsageEntry,
  sanitizeUsageEntry
};
