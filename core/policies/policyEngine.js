const { resolveConflicts } = require('./policyConflictResolver');

class PolicyEngine {
  constructor() {
    this.policies = [];
  }

  registerPolicy(policy) {
    this.policies.push(policy);
  }

  evaluate(context) {
    const activeActions = [];

    for (const policy of this.policies) {
      if (typeof policy.evaluate === 'function') {
        const result = policy.evaluate(context);
        if (result) {
          activeActions.push({ ...result, policy_id: policy.id });
        }
        continue;
      }

      if (policy.condition && this.matches(policy.condition, context)) {
        if (Array.isArray(policy.actions)) {
          activeActions.push(...policy.actions.map(a => ({ ...a, policy_id: policy.id })));
        } else if (policy.action) {
          activeActions.push({ ...policy, policy_id: policy.id });
        }
      }
    }

    if (activeActions.length === 0) return null;

    const resolved = resolveConflicts(activeActions);
    return Array.isArray(resolved) ? resolved[0] : resolved;
  }

  matches(condition, context) {
    if (!condition) return false;
    for (const [key, value] of Object.entries(condition)) {
      if (context[key] !== value) return false;
    }
    return true;
  }
}

module.exports = new PolicyEngine();
