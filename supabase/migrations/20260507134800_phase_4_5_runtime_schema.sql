-- Cresca OS — Phase 4.5 Runtime Schema Migration
-- Timestamp: 20260507134800

-- ==========================================
-- PHASE 1: CORE CRM & TENANTS
-- ==========================================

CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integration_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    provider TEXT NOT NULL, -- 'ghl', 'hubspot', etc.
    enabled BOOLEAN DEFAULT true,
    settings JSONB DEFAULT '{}', -- encrypted tokens, location_id, etc.
    last_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    external_id TEXT, -- GHL contact ID
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    phone TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_opportunities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES crm_contacts(id) ON DELETE CASCADE,
    external_id TEXT, -- GHL opportunity ID
    pipeline_id TEXT,
    stage_id TEXT,
    status TEXT,
    value NUMERIC,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- PHASE 1.5: OPERATIONAL HARDENING
-- ==========================================

CREATE TABLE IF NOT EXISTS event_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT, -- String to support 'system'
    event_type TEXT NOT NULL,
    details JSONB DEFAULT '{}',
    level TEXT DEFAULT 'info',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT,
    workflow_name TEXT NOT NULL,
    status TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT,
    metric_name TEXT NOT NULL,
    value NUMERIC NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_idempotency (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL, -- 'processing', 'completed', 'failed', 'skipped'
    first_seen_at TIMESTAMPTZ DEFAULT now(),
    last_seen_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ,
    replay_count INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    UNIQUE(tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS dead_letter_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT,
    event_type TEXT,
    payload JSONB,
    error_message TEXT,
    attempts INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending', -- 'pending', 'replayed', 'resolved'
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- PHASE 2: RUNTIME INTELLIGENCE
-- ==========================================

CREATE TABLE IF NOT EXISTS runtime_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    value JSONB,
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT,
    agent_name TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runtime_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT,
    action TEXT NOT NULL,
    reason TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- PHASE 3: AUTONOMOUS COORDINATION
-- ==========================================

CREATE TABLE IF NOT EXISTS runtime_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT,
    severity TEXT, -- 'low', 'moderate', 'high', 'critical'
    status TEXT DEFAULT 'open',
    message TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS incident_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id TEXT,
    dedupe_key TEXT,
    provider TEXT,
    severity TEXT,
    status TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_health_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL,
    status TEXT NOT NULL,
    latency_avg NUMERIC,
    error_rate NUMERIC,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_health_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    status TEXT NOT NULL,
    error_count INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- PHASE 4: DISTRIBUTED INTELLIGENCE
-- ==========================================

CREATE TABLE IF NOT EXISTS operational_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    rel_type TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS predictive_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    predictor TEXT NOT NULL,
    confidence NUMERIC,
    signals JSONB DEFAULT '{}',
    action TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coordination_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name TEXT,
    action_type TEXT, -- 'rebalance', 'throttle', 'safe_mode_trigger'
    reason TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- PHASE 4.5: ADDITIONS
-- ==========================================

CREATE TABLE IF NOT EXISTS chaos_test_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario TEXT NOT NULL,
    status TEXT NOT NULL, -- 'passed', 'failed'
    impact_level TEXT,
    recovery_time_ms INTEGER,
    logs JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS policy_evaluations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT,
    event_id TEXT,
    policy_id TEXT,
    decision TEXT, -- 'allowed', 'denied', 'modified'
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_consensus_votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    vote BOOLEAN NOT NULL,
    reason TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_event_logs_tenant ON event_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sync_metrics_tenant ON sync_metrics(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sync_idempotency_key ON sync_idempotency(tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_op_rel_source ON operational_relationships(source_id);
CREATE INDEX IF NOT EXISTS idx_op_rel_target ON operational_relationships(target_id);
