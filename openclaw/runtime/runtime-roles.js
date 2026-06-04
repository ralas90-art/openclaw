const crypto = require('crypto');
const config = require('./runtime-config');

// Capability definitions
const CAPABILITIES = {
  read_runtime: 'read_runtime',
  generate_runtime: 'generate_runtime',
  request_publish: 'request_publish',
  approve_publish: 'approve_publish',
  reject_approval: 'reject_approval',
  view_errors: 'view_errors',
  view_config: 'view_config',
  admin_maintenance: 'admin_maintenance',
  drive_publish: 'drive_publish',
  approval_audit: 'approval_audit'
};

const ROLE_CAPABILITIES = {
  super_admin: Object.values(CAPABILITIES),
  operator: [
    CAPABILITIES.read_runtime,
    CAPABILITIES.generate_runtime
  ],
  publisher: [
    CAPABILITIES.read_runtime,
    CAPABILITIES.generate_runtime,
    CAPABILITIES.request_publish,
    CAPABILITIES.drive_publish,
    CAPABILITIES.approval_audit
  ],
  approver: [
    CAPABILITIES.read_runtime,
    CAPABILITIES.approval_audit,
    CAPABILITIES.approve_publish,
    CAPABILITIES.reject_approval
  ],
  viewer: [
    CAPABILITIES.read_runtime,
    CAPABILITIES.approval_audit
  ]
};

/**
 * Parses a comma-separated list of chat IDs from env variables.
 * @param {string|undefined} envVal
 * @returns {string[]}
 */
function _parseEnvChatIds(envVal) {
  if (!envVal || typeof envVal !== 'string') return [];
  return envVal
    .split(',')
    .map(s => s.trim())
    .filter(s => s !== '');
}

/**
 * Loads all configured roles from environment variables.
 * Fallbacks to allowedChatIds as super_admin if no role variables are set.
 * @returns {Object.<string, string[]>} Mapping of role to array of chat IDs.
 */
function loadRuntimeRoles() {
  const superAdmin = _parseEnvChatIds(process.env.OPENCLAW_ROLE_SUPER_ADMIN_CHAT_IDS);
  const operator = _parseEnvChatIds(process.env.OPENCLAW_ROLE_OPERATOR_CHAT_IDS);
  const publisher = _parseEnvChatIds(process.env.OPENCLAW_ROLE_PUBLISHER_CHAT_IDS);
  const approver = _parseEnvChatIds(process.env.OPENCLAW_ROLE_APPROVER_CHAT_IDS);
  const viewer = _parseEnvChatIds(process.env.OPENCLAW_ROLE_VIEWER_CHAT_IDS);

  const hasAnyRoleConfig = 
    superAdmin.length > 0 ||
    operator.length > 0 ||
    publisher.length > 0 ||
    approver.length > 0 ||
    viewer.length > 0;

  if (!hasAnyRoleConfig) {
    // Backward compatibility fallback: allowedChatIds from config act as super_admin
    const fallbackIds = config.allowedChatIds || [];
    return {
      super_admin: [...fallbackIds],
      operator: [],
      publisher: [],
      approver: [],
      viewer: []
    };
  }

  return {
    super_admin: superAdmin,
    operator: operator,
    publisher: publisher,
    approver: approver,
    viewer: viewer
  };
}

/**
 * Returns roles for a given chat ID.
 * @param {string|number} chatId
 * @returns {string[]}
 */
function getRolesForChatId(chatId) {
  if (chatId === undefined || chatId === null) return [];
  const idStr = String(chatId).trim();
  const roles = module.exports.loadRuntimeRoles();
  const matched = [];
  for (const [role, ids] of Object.entries(roles)) {
    if (ids.includes(idStr)) {
      matched.push(role);
    }
  }
  return matched;
}

/**
 * Returns whether a chat ID has a specific role.
 * @param {string|number} chatId
 * @param {string} role
 * @returns {boolean}
 */
function hasRole(chatId, role) {
  const matched = module.exports.getRolesForChatId(chatId);
  return matched.includes(role);
}

/**
 * Returns effective capability set for a given chat ID.
 * @param {string|number} chatId
 * @returns {Set<string>}
 */
function getEffectiveCapabilities(chatId) {
  const roles = module.exports.getRolesForChatId(chatId);
  const caps = new Set();
  
  const allowPublisherDrivePending = process.env.OPENCLAW_ALLOW_PUBLISHER_DRIVE_PENDING === 'true';
  
  for (const role of roles) {
    let roleCaps = ROLE_CAPABILITIES[role] || [];
    if (role === 'publisher' && !allowPublisherDrivePending) {
      roleCaps = roleCaps.filter(c => c !== CAPABILITIES.drive_publish);
    }
    for (const c of roleCaps) {
      caps.add(c);
    }
  }
  return caps;
}

/**
 * Returns a summary of user counts per role for display.
 * @returns {object}
 */
function getRoleSummary() {
  const roles = module.exports.loadRuntimeRoles();
  const summary = {};
  for (const [role, ids] of Object.entries(roles)) {
    summary[role] = ids.length;
  }
  
  // Determine if using backward compatibility fallback
  const superAdmin = _parseEnvChatIds(process.env.OPENCLAW_ROLE_SUPER_ADMIN_CHAT_IDS);
  const operator = _parseEnvChatIds(process.env.OPENCLAW_ROLE_OPERATOR_CHAT_IDS);
  const publisher = _parseEnvChatIds(process.env.OPENCLAW_ROLE_PUBLISHER_CHAT_IDS);
  const approver = _parseEnvChatIds(process.env.OPENCLAW_ROLE_APPROVER_CHAT_IDS);
  const viewer = _parseEnvChatIds(process.env.OPENCLAW_ROLE_VIEWER_CHAT_IDS);
  const hasAnyRoleConfig = 
    superAdmin.length > 0 ||
    operator.length > 0 ||
    publisher.length > 0 ||
    approver.length > 0 ||
    viewer.length > 0;

  summary.fallbackActive = !hasAnyRoleConfig;
  return summary;
}

/**
 * Formats a role denial message for Telegram.
 * @param {string} command
 * @param {string|number} chatId
 * @returns {string}
 */
function formatRoleDenied(command, chatId) {
  const cleanCmd = command.trim().split(/\s+/)[0];
  const idStr = chatId ? String(chatId).trim() : 'unknown';
  const hashedId = module.exports.hashChatIdForLogs(idStr);
  return `❌ Access Denied: Your role does not grant permission to execute ${cleanCmd} (ID: ${hashedId}).`;
}

/**
 * Returns a SHA-256 hash substring of the chat ID for logging and output checks.
 * @param {string|number} chatId
 * @returns {string}
 */
function hashChatIdForLogs(chatId) {
  if (!chatId) return 'unknown';
  const cleanId = String(chatId).trim();
  return crypto.createHash('sha256').update(cleanId).digest('hex').substring(0, 16);
}

module.exports = {
  loadRuntimeRoles,
  getRolesForChatId,
  hasRole,
  getEffectiveCapabilities,
  getRoleSummary,
  formatRoleDenied,
  hashChatIdForLogs,
  CAPABILITIES,
  ROLE_CAPABILITIES
};
