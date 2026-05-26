-- Phase 5 Productization Layer V1
-- Timestamp: 20260507150000

CREATE TABLE IF NOT EXISTS admin_action_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operator TEXT NOT NULL,
    action TEXT NOT NULL,
    tenant_id TEXT,
    target_type TEXT,
    target_id TEXT,
    request_payload JSONB DEFAULT '{}',
    result TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Recommended indexes for dashboard queries
CREATE INDEX IF NOT EXISTS idx_admin_action_logs_tenant ON admin_action_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_admin_action_logs_action ON admin_action_logs(action);
CREATE INDEX IF NOT EXISTS idx_admin_action_logs_created_at ON admin_action_logs(created_at);

-- Adding common indexes on existing tables for Admin Dashboard performance
CREATE INDEX IF NOT EXISTS idx_event_logs_created_at ON event_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_runtime_incidents_status ON runtime_incidents(status);
CREATE INDEX IF NOT EXISTS idx_runtime_incidents_provider ON runtime_incidents(provider);
CREATE INDEX IF NOT EXISTS idx_runtime_incidents_created_at ON runtime_incidents(created_at);
CREATE INDEX IF NOT EXISTS idx_dead_letter_events_status ON dead_letter_events(status);
CREATE INDEX IF NOT EXISTS idx_dead_letter_events_tenant ON dead_letter_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dead_letter_events_created_at ON dead_letter_events(created_at);
CREATE INDEX IF NOT EXISTS idx_sync_idempotency_status ON sync_idempotency(status);
CREATE INDEX IF NOT EXISTS idx_integration_connections_tenant ON integration_connections(tenant_id);
