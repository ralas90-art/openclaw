function calculateRuntimeHealth(metrics) {
  let score = 100;
  const critical_issues = [];

  if (metrics.dead_letter_count > 10) {
    score -= 20;
    critical_issues.push('Dead letter growth detected');
  }
  if (metrics.avg_latency > 3000) {
    score -= 15;
    critical_issues.push('High provider latency');
  }
  if (metrics.error_rate > 0.1) {
    score -= 30;
    critical_issues.push('Elevated error rate');
  }

  return {
    runtime_health: score > 80 ? 'healthy' : (score > 50 ? 'degraded' : 'unstable'),
    score: Math.max(0, score),
    critical_issues
  };
}

module.exports = { calculateRuntimeHealth };
