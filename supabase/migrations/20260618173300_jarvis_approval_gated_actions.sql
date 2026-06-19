-- SQL Migration: Approval-Gated Actions Layer
-- Timestamp: 20260618173300

ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS action_type TEXT;
ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS priority_id TEXT;
ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS source_type TEXT;
ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS proposed_payload JSONB DEFAULT '{}';
ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
