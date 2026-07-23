/**
 * Sanitizer Unit Test Suite
 * Verifies that secret redaction works across database URLs, bearer tokens, API keys, tickets, errors, and nested objects.
 * Exits non-zero on failure.
 */

const { sanitizeSecrets, sanitizeText, sanitizeLogText, sanitizeObject, sanitizeError } = require('../sanitizer');
const jarvisSanitizer = require('../jarvis/sanitizer');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ Assertion failed: ${message}`);
    process.exit(1);
  }
}

console.log('🧪 Starting Sanitizer Unit Tests...\n');

// Test 1: Module consistency check
assert(typeof sanitizeSecrets === 'function', 'sanitizeSecrets must be a function');
assert(jarvisSanitizer.sanitizeSecrets === sanitizeSecrets, 'jarvis/sanitizer must export the exact same functions as root sanitizer');
console.log('✅ Test 1: Module consistency passed.');

// Test 2: Redact PostgreSQL Connection Strings
const dbUrlTest = 'Connecting to postgresql://user:secretpassword@localhost:5432/mydb?ssl=true';
const sanitizedDbUrl = sanitizeSecrets(dbUrlTest);
assert(!sanitizedDbUrl.includes('secretpassword'), 'PostgreSQL password must be redacted');
assert(sanitizedDbUrl.includes('[REDACTED'), 'Redacted label should be present');
console.log('✅ Test 2: PostgreSQL URL redaction passed.');

// Test 3: Redact DATABASE_URL
const envTest = 'DATABASE_URL=postgresql://admin:supersecret@db.host.com:5432/production';
const sanitizedEnv = sanitizeSecrets(envTest);
assert(!sanitizedEnv.includes('supersecret'), 'DATABASE_URL value must be redacted');
console.log('✅ Test 3: DATABASE_URL redaction passed.');

// Test 4: Redact Bearer Tokens & Auth Headers
const authHeaderTest = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secretpayload';
const sanitizedAuth = sanitizeSecrets(authHeaderTest);
assert(!sanitizedAuth.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), 'Bearer token payload must be redacted');
console.log('✅ Test 4: Bearer token redaction passed.');

// Test 5: Redact Auth Ticket in URLs
const ticketUrlTest = 'GET /api/jarvis/google/connect?ticket=abc123secret456token';
const sanitizedTicketUrl = sanitizeSecrets(ticketUrlTest);
assert(!sanitizedTicketUrl.includes('abc123secret456token'), 'Auth ticket must be redacted');
console.log('✅ Test 5: Auth ticket redaction passed.');

// Test 6: Redact Nested JSON Objects
const sensitiveObj = {
  user: 'admin',
  access_token: 'secret-access-token-123',
  metadata: {
    client_secret: 'top-secret-key',
    normal_field: 'hello'
  }
};
const sanitizedObj = sanitizeObject(sensitiveObj);
assert(sanitizedObj.access_token === '[REDACTED]', 'Nested access_token must be redacted');
assert(sanitizedObj.metadata.client_secret === '[REDACTED]', 'Nested client_secret must be redacted');
assert(sanitizedObj.metadata.normal_field === 'hello', 'Normal fields should remain intact');
console.log('✅ Test 6: Nested object sanitization passed.');

// Test 7: Redact Error Messages
const err = new Error('Database connection failed for postgresql://user:pass123@localhost:5432/db');
const sanitizedErrMsg = sanitizeError(err);
assert(!sanitizedErrMsg.includes('pass123'), 'Error message must not expose password');
console.log('✅ Test 7: Error sanitization passed.');

// Test 8: Sentinel Runtime Test for HTTP Responses, Telegram Replies, Redirects, and Log Outputs
const mockErr = new Error('Failed connecting to postgresql://postgres:mysecretpassword@localhost:5432/db with token mob_tok_123456');
const httpResponseErr = sanitizeError(mockErr);
assert(!httpResponseErr.includes('mysecretpassword'), 'HTTP response must redact db credentials');
assert(!httpResponseErr.includes('mob_tok_123456'), 'HTTP response must redact mobile token');

const tgReply = sanitizeText('⚠️ Error: failed with INTERNAL_ADMIN_TOKEN=secret_admin_token_99');
assert(!tgReply.includes('secret_admin_token_99'), 'Telegram reply must redact INTERNAL_ADMIN_TOKEN');

const redirectUrl = sanitizeText('/google/connect?ticket=secret_ticket_val_123&code=oauth_code_456');
assert(!redirectUrl.includes('secret_ticket_val_123'), 'Redirect URL must redact ticket secret');

const logOutput = sanitizeLogText('Log entry: Bearer srv_sess_abcdef1234567890 failed');
assert(!logOutput.includes('srv_sess_abcdef1234567890'), 'Log output must redact Bearer token payload');

console.log('✅ Test 8: Sentinel HTTP response, Telegram reply, redirect, and log sanitization passed.');

console.log('\n🎉 ALL Sanitizer Tests Passed Successfully!');
