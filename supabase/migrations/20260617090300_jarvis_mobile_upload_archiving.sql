-- Jarvis mobile upload archiving columns migration
-- Timestamp: 20260617090300

ALTER TABLE jarvis_mobile_uploads
ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;

ALTER TABLE jarvis_mobile_uploads
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
