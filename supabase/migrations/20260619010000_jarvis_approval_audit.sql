-- SQL Migration: Approval Audit and Action History
-- Timestamp: 20260619010000

-- Add telemetry tracking columns to jarvis_approval_requests
ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS proposed_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;
ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS executed_by TEXT;
ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS source_priority_id TEXT;
ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS action_result_summary TEXT;
ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS execution_error_summary TEXT;

-- Create approvals audit events table
CREATE TABLE IF NOT EXISTS jarvis_approval_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    approval_id UUID REFERENCES jarvis_approval_requests(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    actor TEXT,
    previous_status TEXT,
    new_status TEXT NOT NULL,
    safe_summary TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
