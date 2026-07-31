/**
 * OpenClaw Runtime Job ID Generator & Validator
 */

const crypto = require('crypto');

/**
 * Generates a unique, filesystem-safe and Telegram-safe runtime job ID.
 * Format: r_YYYYMMDD_HHMMSS_<shortRandomId>
 * Example: r_20260731_005418_8ade43
 * @returns {string}
 */
function generateRuntimeJobId() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  const shortRandomId = crypto.randomBytes(3).toString('hex');
  
  return `r_${year}${month}${day}_${hours}${minutes}${seconds}_${shortRandomId}`;
}

/**
 * Validates a runtime job ID using a strict regex.
 * Prevents command injection and path traversal attempts.
 * Supports both canonical r_ and legacy rt_ prefixes.
 * @param {string} jobId
 * @returns {boolean}
 */
function isValidRuntimeJobId(jobId) {
  if (typeof jobId !== 'string') {
    return false;
  }
  return /^(r|rt)_\d{8}_\d{6}_[a-f0-9]{6}$/.test(jobId);
}

module.exports = {
  generateRuntimeJobId,
  isValidRuntimeJobId
};
