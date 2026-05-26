function calculateRisk(tenant_id, metrics = {}) {
  let score = 0;
  const indicators = [];

  if (metrics.failure_rate > 0.2) {
    score += 40;
    indicators.push('High failure rate detected');
  }
  if (metrics.retry_count > 10) {
    score += 30;
    indicators.push('Retry surge detected');
  }
  if (metrics.latency > 5000) {
    score += 20;
    indicators.push('Significant provider latency');
  }

  score = Math.min(100, score);

  return {
    risk_score: score,
    risk_level: score > 70 ? 'high' : (score > 30 ? 'medium' : 'low'),
    indicators
  };
}

module.exports = { calculateRisk };
