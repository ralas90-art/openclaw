-- Cresca OS Phase 1 Foundation Migration
-- Goal: Establish the multi-tenant source of truth for AI Operating Infrastructure.

-- 0. Helper: Updated At Trigger Function
CREATE OR REPLACE FUNCTION handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. Tenants Table
-- Core isolation unit. Every business using Cresca OS has a tenant record.
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TRIGGER set_tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- 2. Integration Connections
-- Stores per-tenant credentials for GHL, Airtable, Telegram, etc.
CREATE TABLE integration_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- e.g. 'ghl', 'airtable', 'telegram'
  credentials JSONB DEFAULT '{}', -- Encrypted in production
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_integrations_tenant_id ON integration_connections(tenant_id);
CREATE TRIGGER set_integrations_updated_at BEFORE UPDATE ON integration_connections FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- 3. Leads Table
-- Core lead repository. The baseline for all outreach.
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  website TEXT,
  address TEXT,
  niche TEXT,
  location TEXT,
  rating DECIMAL(3,2),
  reviews INTEGER DEFAULT 0,
  source TEXT DEFAULT 'google_places',
  status TEXT DEFAULT 'New', -- New, Qualified, Contacted, Interested, Uninterested
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_leads_tenant_id ON leads(tenant_id);
CREATE INDEX idx_leads_status ON leads(status);
CREATE TRIGGER set_leads_updated_at BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- 4. Lead Intelligence
-- Enriched AI data, scores, and insights. Linked 1:1 or 1:N to a lead.
CREATE TABLE lead_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  ai_score INTEGER CHECK (ai_score >= 0 AND ai_score <= 10),
  insight TEXT,
  outreach_angle TEXT,
  analysis_payload JSONB DEFAULT '{}', -- Raw model output
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_intel_lead_id ON lead_intelligence(lead_id);
CREATE INDEX idx_intel_tenant_id ON lead_intelligence(tenant_id);

-- 5. Workflow Runs
-- Tracks the lifecycle of a high-level task (e.g. Lead Gen, Audit).
CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_name TEXT NOT NULL, -- e.g. 'lead_gen_pipeline'
  status TEXT DEFAULT 'pending', -- pending, running, completed, failed
  input_params JSONB DEFAULT '{}',
  output_data JSONB DEFAULT '{}',
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_workflows_tenant_id ON workflow_runs(tenant_id);
CREATE INDEX idx_workflows_status ON workflow_runs(status);

-- 6. Events (Definitions)
-- Registry of valid events the system can emit.
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT UNIQUE NOT NULL, -- e.g. 'lead.found', 'lead.scored'
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Event Logs (Transactions)
-- The immutable audit trail of every event emitted in the system.
CREATE TABLE event_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- References events.event_type
  lead_id UUID REFERENCES leads(id), -- Optional link
  workflow_run_id UUID REFERENCES workflow_runs(id), -- Optional link
  payload JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_event_logs_tenant_id ON event_logs(tenant_id);
CREATE INDEX idx_event_logs_type ON event_logs(event_type);
CREATE INDEX idx_event_logs_lead_id ON event_logs(lead_id);

-- ROW LEVEL SECURITY (RLS) PLACEHOLDERS
-- Enabling RLS to enforce tenant isolation.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_intelligence ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_logs ENABLE ROW LEVEL SECURITY;

-- Note: Complex policies (e.g. using auth.uid()) will be added in Phase 2.
-- For now, tables are secured but policies are not yet active for public access.

COMMENT ON TABLE tenants IS 'Stores root business units using the Cresca OS platform.';
COMMENT ON TABLE integration_connections IS 'Stores tenant-specific API credentials for external services.';
COMMENT ON TABLE leads IS 'Stores basic business information for potential prospects.';
COMMENT ON TABLE lead_intelligence IS 'Stores AI-generated scores and outreach strategies for leads.';
COMMENT ON TABLE workflow_runs IS 'Tracks state and history of automated process executions.';
COMMENT ON TABLE events IS 'System-wide registry of event types.';
COMMENT ON TABLE event_logs IS 'The immutable event store of all system actions.';
