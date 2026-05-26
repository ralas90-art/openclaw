function calculatePriority(event, data, tenantInfo = {}) {
  let score = 50; // Neutral base
  let reason = 'General operational event';

  // Critical factors
  if (event.includes('deadletter')) {
    score = 90;
    reason = 'Dead letter event requires attention';
  }
  if (event.includes('auth_failure')) {
    score = 95;
    reason = 'Authentication failure - immediate action required';
  }
  if (tenantInfo.is_premium) {
    score += 10;
    reason += ' (Premium Tenant)';
  }

  // Cap score
  score = Math.min(100, Math.max(0, score));

  let priority = 'low';
  if (score >= 90) priority = 'critical';
  else if (score >= 70) priority = 'high';
  else if (score >= 40) priority = 'medium';

  return { priority, score, reason };
}

module.exports = { calculatePriority };
