/**
 * OpenClaw Runtime Bot Allowlist
 * Phase 1: Only revenue-master-orchestrator is enabled.
 */

const RUNTIME_ENABLED_BOTS = [
  'revenue-master-orchestrator',
  'content-forge',
  'lead-acquisition-engine'
];

/**
 * Validates if a bot is allowed to run under the runtime executor.
 * @param {string} botSlug
 * @returns {boolean}
 */
function isBotAllowed(botSlug) {
  if (!botSlug) return false;
  return RUNTIME_ENABLED_BOTS.includes(botSlug.trim().toLowerCase());
}

module.exports = {
  RUNTIME_ENABLED_BOTS,
  isBotAllowed
};
