/**
 * Consolidated Sanitizer Module for OpenClaw / Hermes / Jarvis
 * Provides unified secret redaction and error message sanitization across the entire system.
 */

const SECRET_PATTERNS = [
  /postgres(ql)?:\/\/[^\s"':]+:[^\s"':]+@[^\s"':]+/gi,
  /DATABASE_URL=\S+/gi,
  /INTERNAL_ADMIN_TOKEN=\S+/gi,
  /TELEGRAM_BOT_TOKEN=\S+/gi,
  /TELEGRAM_WEBHOOK_SECRET=\S+/gi,
  /JARVIS_ENCRYPTION_KEY=\S+/gi,
  /GOOGLE_CLIENT_SECRET=\S+/gi,
  /GOOGLE_REFRESH_TOKEN=\S+/gi,
  /access_token=[^\s&"'`]+/gi,
  /refresh_token=[^\s&"'`]+/gi,
  /auth_token=[^\s&"'`]+/gi,
  /ticket=[^\s&"'`]+/gi,
  /mob_tok_[^\s&"'`]+/gi,
  /Bearer\s+[A-Za-z0-9\-\._~\+\/]+=*/gi,
  /authTag=[^\s&"'`]+/gi,
  /ciphertext=[^\s&"'`]+/gi,
  /(password|secret|api_key|token)\s*[:=]\s*["']?[^\s"';,]+["']?/gi
];

/**
 * Redacts known sensitive patterns (tokens, passwords, API keys, connection strings) from text.
 * @param {string} text
 * @returns {string} Sanitized string
 */
function sanitizeSecrets(text) {
  if (text === null || text === undefined) return '';
  if (typeof text !== 'string') {
    if (typeof text === 'object') {
      try {
        return sanitizeObject(text);
      } catch (e) {
        return '[UNPARSABLE_OBJECT]';
      }
    }
    text = String(text);
  }

  let sanitized = text;
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match) => {
      if (match.includes('=')) {
        const parts = match.split('=');
        return `${parts[0]}=[REDACTED]`;
      }
      if (match.toLowerCase().startsWith('bearer ')) {
        return 'Bearer [REDACTED]';
      }
      if (match.toLowerCase().startsWith('postgres')) {
        return 'postgresql://[REDACTED_CREDENTIALS]';
      }
      return '[REDACTED]';
    });
  }
  return sanitized;
}

const sanitizeText = sanitizeSecrets;
const sanitizeLogText = sanitizeSecrets;

/**
 * Recursively sanitize an object or array.
 * @param {Object|Array} obj
 * @returns {Object|Array} Copy of object with secrets redacted
 */
function sanitizeObject(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitizeSecrets(obj);
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }

  const result = {};
  const SENSITIVE_KEYS = [
    'password', 'secret', 'token', 'access_token', 'refresh_token',
    'auth_token', 'database_url', 'client_secret', 'encryption_key',
    'bearer', 'authorization', 'ticket'
  ];

  for (const [key, value] of Object.entries(obj)) {
    const isSensitive = SENSITIVE_KEYS.some(k => key.toLowerCase().includes(k));
    if (isSensitive && typeof value === 'string') {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeObject(value);
    } else if (typeof value === 'string') {
      result[key] = sanitizeSecrets(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Transforms errors into safe user-facing error strings without leaking internal details or credentials.
 * @param {Error|any} err
 * @returns {string}
 */
function sanitizeError(err) {
  if (!err) return 'An unknown error occurred.';
  const msg = typeof err === 'string' ? err : (err.message || 'An error occurred.');
  const cleanMsg = sanitizeSecrets(msg);

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
  sanitizeObject,
  sanitizeError
};
