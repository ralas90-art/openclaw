/**
 * Re-exports the root sanitizer module for modules inside jarvis/
 */
const sanitizer = require('../sanitizer');

module.exports = {
  ...sanitizer,
  sanitizeSecrets: sanitizer.sanitizeText,
  sanitizeLogText: sanitizer.sanitizeText,
};
