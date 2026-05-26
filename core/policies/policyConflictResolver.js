function resolveConflicts(actions) {
  if (actions.length <= 1) return actions;

  // Priority-based resolution
  // 1. Critical infrastructure actions win
  // 2. Enterprise SLA actions win over standard
  // 3. Most restrictive protection wins

  const resolved = [];
  const categories = {
    PROTECTION: [],
    PRIORITY: [],
    GENERAL: []
  };

  actions.forEach(a => {
    if (a.type === 'protection' || a.action.includes('throttle') || a.action.includes('pause')) {
      categories.PROTECTION.push(a);
    } else if (a.type === 'priority' || a.action.includes('sla')) {
      categories.PRIORITY.push(a);
    } else {
      categories.GENERAL.push(a);
    }
  });

  // If we have protection policies, they override general ones
  if (categories.PROTECTION.length > 0) {
    // Pick the most restrictive
    return [categories.PROTECTION.sort((a, b) => (b.restriction_score || 0) - (a.restriction_score || 0))[0]];
  }

  return actions;
}

module.exports = { resolveConflicts };
