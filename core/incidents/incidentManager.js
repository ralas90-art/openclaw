const { supabase } = require('../../lib/supabase');

class IncidentManager {
  constructor() {
    this.activeIncidents = new Map();
    this.windowMs = 300000; // 5 minute window
  }

  async reportFailure(tenant_id, provider, event_type, error_class) {
    const dedupeKey = `${provider}:${event_type}:${error_class}`;
    
    let incident = this.activeIncidents.get(dedupeKey);

    if (incident && (new Date() - incident.lastSeenAt < this.windowMs)) {
      incident.count++;
      incident.lastSeenAt = new Date();
      incident.tenants.add(tenant_id);
      return incident.id;
    }

    // Create new incident
    const newIncident = {
      id: Math.random().toString(36).substr(2, 9),
      dedupeKey,
      provider,
      eventType: event_type,
      errorClass: error_class,
      count: 1,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      tenants: new Set([tenant_id]),
      status: 'open'
    };

    this.activeIncidents.set(dedupeKey, newIncident);
    await this.persistIncident(newIncident);
    return newIncident.id;
  }

  async persistIncident(incident) {
    if (!supabase) return;
    try {
      await supabase.from('incident_history').insert([{
        incident_id: incident.id,
        dedupe_key: incident.dedupeKey,
        provider: incident.provider,
        severity: 'moderate',
        status: 'open',
        metadata: {
          event_type: incident.eventType,
          error_class: incident.errorClass,
          count: incident.count
        },
        created_at: incident.firstSeenAt.toISOString()
      }]);
    } catch (err) {
      console.error('[IncidentManager] Failed to persist incident:', err.message);
    }
  }

  getOpenIncidents() {
    return Array.from(this.activeIncidents.values()).filter(i => i.status === 'open');
  }
}

module.exports = new IncidentManager();
