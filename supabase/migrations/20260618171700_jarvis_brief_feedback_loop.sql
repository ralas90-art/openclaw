-- SQL Migration: Daily Brief Feedback Loop & Quality Controls
-- Timestamp: 20260618171700

CREATE TABLE IF NOT EXISTS jarvis_brief_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brief_date DATE NOT NULL DEFAULT CURRENT_DATE,
    feedback_type TEXT NOT NULL CHECK (feedback_type IN ('good', 'bad')),
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT jarvis_brief_feedback_date_type_unique UNIQUE (brief_date, feedback_type)
);

CREATE TABLE IF NOT EXISTS jarvis_priority_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    priority_id TEXT NOT NULL,
    project_slug TEXT REFERENCES jarvis_projects(slug) ON DELETE SET NULL,
    feedback_type TEXT NOT NULL CHECK (feedback_type IN ('note', 'ignored', 'pinned')),
    score INTEGER,
    reason TEXT,
    user_feedback TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT jarvis_priority_feedback_unique UNIQUE (priority_id, feedback_type)
);
