/**
 * Tenant Manager
 * Handles tenant identification and configuration loading from Postgres.
 */
class TenantManager {
  constructor() {
    this.cache = new Map();
  }

  async getTenant(tenantId) {
    if (this.cache.has(tenantId)) {
      return this.cache.get(tenantId);
    }

    // TODO: Load from Postgres
    const tenant = {
      id: tenantId,
      name: 'Placeholder Business',
      config: {
        ghl: { location_id: process.env.GHL_LOCATION_ID },
        airtable: { base_id: process.env.AIRTABLE_BASE_ID }
      }
    };

    this.cache.set(tenantId, tenant);
    return tenant;
  }
}

module.exports = new TenantManager();
