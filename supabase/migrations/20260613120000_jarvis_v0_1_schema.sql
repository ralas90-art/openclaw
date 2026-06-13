-- Jarvis v0.1 DB Schema Migration
-- Timestamp: 20260613120000

-- =====================================================================
-- 1. CORE PROJECT MEMORY & STATE
-- =====================================================================

CREATE TABLE IF NOT EXISTS jarvis_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    phase TEXT,
    primary_objective TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jarvis_daily_briefs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brief_date DATE UNIQUE NOT NULL DEFAULT CURRENT_DATE,
    completed_summary TEXT,
    active_summary TEXT,
    blockers_summary TEXT,
    next_actions_summary TEXT,
    suggested_commands JSONB DEFAULT '[]',
    raw_brief_markdown TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jarvis_completed_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_slug TEXT REFERENCES jarvis_projects(slug) ON DELETE SET NULL,
    task_name TEXT NOT NULL,
    outcome TEXT,
    artifacts JSONB DEFAULT '[]',
    completed_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jarvis_blockers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_slug TEXT REFERENCES jarvis_projects(slug) ON DELETE SET NULL,
    description TEXT NOT NULL,
    priority TEXT DEFAULT 'normal',
    status TEXT DEFAULT 'active',
    steps_to_resolve TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS jarvis_next_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_slug TEXT REFERENCES jarvis_projects(slug) ON DELETE SET NULL,
    action TEXT NOT NULL,
    priority TEXT DEFAULT 'normal',
    status TEXT DEFAULT 'pending',
    recommended_command TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jarvis_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_slug TEXT REFERENCES jarvis_projects(slug) ON DELETE SET NULL,
    decision TEXT NOT NULL,
    context TEXT,
    rationale TEXT,
    impact TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =====================================================================
-- 2. CENTRAL APPROVALS REGISTRY
-- =====================================================================

CREATE TABLE IF NOT EXISTS jarvis_approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    approval_type TEXT NOT NULL,
    project_slug TEXT REFERENCES jarvis_projects(slug) ON DELETE SET NULL,
    requested_action TEXT NOT NULL,
    payload JSONB DEFAULT '{}',
    risk_level TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'pending',
    requested_by TEXT DEFAULT 'jarvis',
    approved_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    approved_at TIMESTAMPTZ,
    executed_at TIMESTAMPTZ,
    execution_result JSONB DEFAULT '{}'
);

-- =====================================================================
-- 3. CONNECTOR MANAGEMENT
-- =====================================================================

CREATE TABLE IF NOT EXISTS jarvis_connectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connector_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    enabled BOOLEAN DEFAULT true,
    read_permissions JSONB DEFAULT '[]',
    write_permissions JSONB DEFAULT '[]',
    write_gated BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jarvis_connector_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connector_id TEXT UNIQUE REFERENCES jarvis_connectors(connector_id) ON DELETE CASCADE,
    access_token TEXT,
    refresh_token TEXT,
    token_type TEXT DEFAULT 'Bearer',
    expires_at TIMESTAMPTZ,
    client_id TEXT,
    client_secret TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jarvis_connector_sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connector_id TEXT REFERENCES jarvis_connectors(connector_id) ON DELETE CASCADE,
    sync_status TEXT NOT NULL,
    records_synced INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TIMESTAMPTZ DEFAULT now(),
    ended_at TIMESTAMPTZ DEFAULT now()
);

-- =====================================================================
-- 4. MOBILE INTAKE
-- =====================================================================

CREATE TABLE IF NOT EXISTS jarvis_mobile_uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    intake_source TEXT NOT NULL,
    task_type TEXT,
    project_slug TEXT REFERENCES jarvis_projects(slug) ON DELETE SET NULL,
    text_content TEXT,
    media_url TEXT,
    notes TEXT,
    processed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jarvis_mobile_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash TEXT UNIQUE NOT NULL,
    device_name TEXT NOT NULL,
    device_id TEXT NOT NULL,
    active BOOLEAN DEFAULT true,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =====================================================================
-- 5. LOCAL FILE INDEXING
-- =====================================================================

CREATE TABLE IF NOT EXISTS jarvis_local_folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_path TEXT UNIQUE NOT NULL,
    access_level INTEGER DEFAULT 0,
    approved BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jarvis_local_file_index (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_id UUID REFERENCES jarvis_local_folders(id) ON DELETE CASCADE,
    file_path TEXT UNIQUE NOT NULL,
    file_name TEXT NOT NULL,
    size_bytes BIGINT,
    extension TEXT,
    last_modified TIMESTAMPTZ,
    file_hash TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jarvis_file_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action_type TEXT NOT NULL,
    source_path TEXT NOT NULL,
    target_path TEXT,
    reason TEXT,
    status TEXT DEFAULT 'pending',
    approval_id UUID REFERENCES jarvis_approval_requests(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- =====================================================================
-- SEED INITIAL PROJECT RECORDS
-- =====================================================================

INSERT INTO jarvis_projects (slug, name, status, phase, primary_objective)
VALUES
    ('septivolt', 'SeptiVolt', 'active', 'Phase 2', 'Deliver simulator slide renderings and trainer tools.'),
    ('new-era-solar', 'New Era Solar', 'active', 'Phase 1', 'Establish contact discovery scripts and high-conversion GHL follow-ups.'),
    ('cresca-os', 'Cresca OS', 'active', 'Phase 4', 'Refine AI copywriting protocols and authority SEO engine.'),
    ('g-g-cleaning', 'G&G Cleaning', 'active', 'Phase 3', 'Onboard active cleaning leads and wire internal workflow automation.'),
    ('bright-future-homes', 'Erick/Bright Future Homes', 'active', 'Phase 1', 'Initiate intake pipeline and local design variants.'),
    ('content-creation', 'Content Creation', 'active', 'Phase 1', 'Optimize ad variations across YouTube, TikTok, and Instagram.')
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    status = EXCLUDED.status,
    phase = EXCLUDED.phase,
    primary_objective = EXCLUDED.primary_objective,
    updated_at = now();
