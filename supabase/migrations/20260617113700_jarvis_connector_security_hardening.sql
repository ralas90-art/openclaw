-- Migration: Phase 5B / 5C Security Hardening for Connectors
-- Timestamp: 20260617113700

ALTER TABLE jarvis_connector_tokens 
ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_sync_status TEXT DEFAULT 'unknown',
ADD COLUMN IF NOT EXISTS rotation_status TEXT DEFAULT 'active';
