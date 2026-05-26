const runtimeGovernor = require('./runtimeGovernor');

class SLACoordinator {
  constructor() {
    this.baselineFloor = 0.2; // 20% reserved for high SLA
  }

  calculateReservedCapacity(totalLoad, providerHealth, activeIncidents) {
    let reservation = this.baselineFloor;

    // Scale based on load
    if (totalLoad > 0.8) {
      reservation += 0.2; // Increase reservation during high load
    }

    // Scale based on incidents
    if (activeIncidents > 0) {
      reservation += 0.1 * activeIncidents;
    }

    // Safe mode increases reservation to protect critical paths
    if (runtimeGovernor.isSafeMode()) {
      reservation = 0.8; 
    }

    return Math.min(1.0, reservation);
  }

  shouldPrioritize(tenantTier, currentLoad, reservation) {
    if (tenantTier === 'enterprise') return true;
    
    // Standard tenants only if within non-reserved capacity
    return currentLoad < (1.0 - reservation);
  }
}

module.exports = new SLACoordinator();
