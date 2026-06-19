# Phase 6.1: Daily Brief Feedback Loop & Quality Control Filters

This document explains the schema definitions, command lists, and behavior of the Morning Command Feedback Loop and Quality Control Filters.

---

## 🔒 Strictly Read-Only Safety Gating

Phase 6.1 enforces the same **strict read-only safety rules** as previous phases:
* Gmail API permissions are kept read-only (`gmail.readonly`). No emails or drafts are created, sent, archived, or deleted.
* Google Drive metadata permissions are kept read-only (`drive.metadata.readonly`). No files are moved, renamed, created, or deleted.
* Textual feedback, ratings, ignores, and pins are stored completely locally on the Postgres (`jarvis_brief_feedback` and `jarvis_priority_feedback`) database tables.

---

## 📊 Database Feedback Schema

Two tables are introduced to persist rating and prioritization preferences:

### 1. `jarvis_brief_feedback`
Stores general satisfaction ratings (good or bad) for Compiled Daily Briefs.
```sql
CREATE TABLE IF NOT EXISTS jarvis_brief_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brief_date DATE NOT NULL DEFAULT CURRENT_DATE,
    feedback_type TEXT NOT NULL CHECK (feedback_type IN ('good', 'bad')),
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT jarvis_brief_feedback_date_type_unique UNIQUE (brief_date, feedback_type)
);
```

### 2. `jarvis_priority_feedback`
Stores pins, ignores, and notes associated with specific Priority IDs (or project slugs).
```sql
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
```

---

## 🧠 Quality Control & Scoring Rules

To improve brief reliability and trust:
1. **Stable Priority IDs**: Every scored item is assigned a stable ID of the format `type:id` (e.g. `email:msg1`, `blocker:block1`, `mobile_note:note1`) to ensure feedback matches the correct item day-over-day.
2. **Ignored Items (De-prioritization)**: Submitting `/jarvis_ignore_priority <priority_id>` subtracts **100 points** from the item's score (or any item matching its project slug if the ID is a project slug).
3. **Pinned Items (Prioritization)**: Submitting `/jarvis_pin_priority <priority_id>` adds **50 points** to the item's score (or project).
4. **Stale Blockers Decay**: If an active blocker is stale for **more than 3 days**, and contains no urgent keywords (`urgent`, `asap`, `due`, `payment`, etc.), it undergoes a **-15 points decay penalty** to prevent it from permanently crowding out newer active items.
5. **Concise Brief Cap**: The `/jarvis_brief` output is capped at a maximum of **3 items** per category. If more exist, it adds an ellipsis (e.g., `... and 2 more unread emails.`) to keep morning updates actionable and readable.

---

## 📲 Telegram Feedback Commands

### 1. Daily Brief Ratings
* `/jarvis_brief_good` - Log today's brief as good quality.
* `/jarvis_brief_bad` - Log today's brief as bad/irrelevant quality.

### 2. Priority Interactions
* `/jarvis_priority_feedback <priority_id> <note>` - Log a specific note regarding a priority item.
* `/jarvis_ignore_priority <priority_id>` - Ignore and de-prioritize an item/project.
* `/jarvis_pin_priority <priority_id>` - Pin and promote an item/project.

### 3. Priorities Filtration
* `/jarvis_priorities today` - Lists the top 3 priorities scored for today (Default).
* `/jarvis_priorities urgent` - Lists all priorities with score >= 25 or urgent keywords.
* `/jarvis_priorities project <slug>` - Filter priorities for a specific project slug.
* `/jarvis_priorities ignored` - Lists currently ignored priority IDs.
* `/jarvis_priorities pinned` - Lists currently pinned priority IDs.
