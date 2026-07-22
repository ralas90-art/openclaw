/**
 * Consolidated Sanitizer Module for OpenClaw / Hermes / Jarvis
 * Provides unified secret redaction and error message sanitization.
 */

const SECRET_PATTERNS = [
  /(bearer\s+)[a-zA-Z0-9_\-\.]+/gi,
  /(postgres:\/\/[^:]+:)[^@]+(@)/gi,
  /(api_key\s*[:=]\s*['"]?)[a-zA-Z0-9_\-]+(['"]?)/gi,
  /(client_secret\s*[:=]\s*['"]?)[a-zA-Z0-9_\-]+(['"]?)/gi,
  /(access_token\s*[:=]\s*['"]?)[a-zA-Z0-9_\-]+(['"]?)/gi,
  /(refresh_token\s*[:=]\s*['"]?)[a-zA-Z0-9_\-]+(['"]?)/gi,
  /(private_key\s*[:=]\s*['"]?)[a-zA-Z0-9_\-\s\n\r\+=]+(['"]?)/gi
];

/**
 * Redacts known sensitive patterns (tokens, passwords, API keys) from text.
 */
function sanitizeSecrets(text) {
  if (!text || typeof text !== 'string') return text;
  let sanitized = text;
  
  sanitized = sanitized.replace(/(bearer\s+)[a-zA-Z0-9_\-\.]+/gi, '$1[REDACTED]');
  sanitized = sanitized.replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@)/gi, '$1[REDACTED]$2');
  sanitized = sanitized.replace(/((?:INTERNAL_ADMIN_TOKEN|TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|JARVIS_ENCRYPTION_KEY|api_key|client_secret|access_token|refresh_token)\s*[:=]\s*['"]?)[a-zA-Z0-9_\-\.]+(['"]?)/gi, '$1[REDACTED]$2');

  return sanitized;
}

const sanitizeText = sanitizeSecrets;
const sanitizeLogText = sanitizeSecrets;

/**
 * Transforms errors into safe user-facing error strings without leaking internal details.
 */
function sanitizeError(err) {
  if (!err) return 'An unknown error occurred.';
  const msg = typeof err === 'string' ? err : (err.message || 'An error occurred.');
  
  // First redact any embedded secrets
  const cleanMsg = sanitizeSecrets(msg);
  
  // Check for internal system errors or stack traces that shouldn't leak to end users
  if (
    cleanMsg.includes('ECONNREFUSED') ||
    cleanMsg.includes('ENOTFOUND') ||
    cleanMsg.includes('pg_') ||
    cleanMsg.includes('SyntaxError') ||
    cleanMsg.includes('node_modules') ||
    cleanMsg.includes('at Client.') ||
    cleanMsg.includes('at process')
  ) {
    return 'Internal server error processing request.';
  }
  
  return cleanMsg;
}

module.exports = {
  sanitizeSecrets,
  sanitizeText,
  sanitizeLogText,
  sanitizeError
};
