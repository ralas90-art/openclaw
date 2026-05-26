const DEFAULT_POLICIES = {
  sync_contacts: true,
  sync_opportunities: false,
  sync_notes: true,
  sync_tags: true,
  prevent_duplicate_contacts: true,
  allow_stage_advancement: false,
  allow_replay: true,
  retry_cap: 3
};

function resolveTenantPolicy(tenantSettings = {}) {
  return {
    ...DEFAULT_POLICIES,
    ...tenantSettings.sync_policies
  };
}

function checkPolicy(policy, action) {
  return policy[action] === true;
}

module.exports = { resolveTenantPolicy, checkPolicy, DEFAULT_POLICIES };
