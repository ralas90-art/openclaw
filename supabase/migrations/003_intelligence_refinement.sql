-- Refine lead_intelligence table for Phase 1 V1 engine
ALTER TABLE lead_intelligence ADD COLUMN IF NOT EXISTS score INTEGER;
ALTER TABLE lead_intelligence ADD COLUMN IF NOT EXISTS grade TEXT;
ALTER TABLE lead_intelligence ADD COLUMN IF NOT EXISTS recommendation TEXT;

-- Rename outreach_angle to outreach_strategy if needed, or just leave it.
-- The schema has outreach_angle, let's use it.
