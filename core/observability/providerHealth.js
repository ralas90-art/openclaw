const STATES = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNSTABLE: 'unstable',
  OFFLINE: 'offline',
  RECOVERING: 'recovering'
};

function resolveProviderState(latency, errorRate) {
  if (errorRate > 0.5) return STATES.OFFLINE;
  if (errorRate > 0.2) return STATES.UNSTABLE;
  if (latency > 5000) return STATES.DEGRADED;
  return STATES.HEALTHY;
}

module.exports = { resolveProviderState, STATES };
