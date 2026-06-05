const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function getAuditFilePath() {
  const root = process.env.OPENCLAW_WORKSPACE_ROOT || path.join(__dirname, '../..');
  return path.resolve(root, 'openclaw', 'dashboard', 'data', 'dashboard-action-audit.json');
}

function generateActionId() {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:T.Z]/g, '').substring(0, 14);
  const rand = crypto.randomBytes(3).toString('hex');
  return `act_${timestamp}_${rand}`;
}

function sanitizeData(val) {
  if (!val) return val;
  if (typeof val === 'string') {
    // Redact absolute paths
    let clean = val.replace(/[a-zA-Z]:\\[\\\w\s.-]+/g, 'openclaw/outbox/')
                   .replace(/\/[\w\s.-]+\/[\w\s.-]+/g, 'openclaw/outbox/');
    // Redact typical API keys / secrets
    clean = clean.replace(/(sk-[a-zA-Z0-9]{20,})/g, 'REDACTED_API_KEY')
                 .replace(/(AIzaSy[a-zA-Z0-9_-]{20,})/g, 'REDACTED_API_KEY');
    return clean;
  }
  if (Array.isArray(val)) {
    return val.map(sanitizeData);
  }
  if (typeof val === 'object') {
    const res = {};
    for (const key of Object.keys(val)) {
      if (['prompt', 'text', 'rawPrompt', 'secret', 'apiKey', 'token', 'stack', 'stackTrace'].includes(key)) {
        res[key] = 'REDACTED';
      } else {
        res[key] = sanitizeData(val[key]);
      }
    }
    return res;
  }
  return val;
}

function logDashboardAction({ actionType, hermesJobId, approvalId, actor, resultStatus, safeMessage, metadata }) {
  const filePath = getAuditFilePath();
  const dir = path.dirname(filePath);
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let list = [];
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      list = JSON.parse(content || '[]');
    } catch (err) {
      console.warn(`[dashboard-action-audit] Failed to parse audit log, resetting: ${err.message}`);
    }
  }

  const event = {
    actionId: generateActionId(),
    actionType,
    hermesJobId: hermesJobId || null,
    approvalId: approvalId || null,
    actor: actor || 'dashboard_admin',
    timestamp: new Date().toISOString(),
    resultStatus,
    safeMessage: sanitizeData(safeMessage) || '',
    metadata: sanitizeData(metadata) || {}
  };

  list.push(event);
  fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf8');
  return event;
}

function getAuditLogs() {
  const filePath = getAuditFilePath();
  if (!fs.existsSync(filePath)) return [];
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content || '[]');
  } catch (err) {
    return [];
  }
}

module.exports = {
  logDashboardAction,
  getAuditLogs
};
