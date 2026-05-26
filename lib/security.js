const { supabase } = require('./supabase');

function maskCredential(cred) {
  if (!cred) return 'N/A';
  if (cred.length < 8) return '********';
  return `${cred.substring(0, 4)}...${cred.substring(cred.length - 4)}`;
}

function redactPayload(payload, sensitiveFields = ['api_key', 'access_token', 'password', 'token']) {
  const redacted = { ...payload };
  for (const field of sensitiveFields) {
    if (redacted[field]) redacted[field] = '[REDACTED]';
    if (redacted.settings && redacted.settings[field]) redacted.settings[field] = '[REDACTED]';
  }
  return redacted;
}

async function logAudit(tenant_id, user_id, action, target_type, target_id, details = {}) {
  const redactedDetails = redactPayload(details);
  console.log(`[Audit] ${action} on ${target_type}:${target_id} by ${user_id || 'system'}`);

  if (!supabase) return;

  try {
    const { error } = await supabase
      .from('audit_logs')
      .insert([{
        tenant_id,
        user_id: user_id || 'system',
        action,
        target_type,
        target_id,
        details: redactedDetails,
        created_at: new Date().toISOString()
      }]);

    if (error) throw error;
  } catch (err) {
    console.error('Failed to write to audit_logs:', err.message);
  }
}

module.exports = { maskCredential, redactPayload, logAudit };
