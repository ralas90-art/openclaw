/**
 * Database Migrations for Jarvis
 * Centralized, idempotent database schema setup and migrations.
 */

const { queryDb } = require('./db');

async function runMigrations() {
  console.log('[JarvisMigrations] Running database schema setup and migrations...');

  // 1. jarvis_work_sessions table
  const sqlWorkSessions = `
    CREATE TABLE IF NOT EXISTS jarvis_work_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_slug TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      summary TEXT,
      changed_files_summary TEXT,
      tests_run_summary TEXT,
      blockers TEXT,
      next_actions TEXT,
      source TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;

  // 2. Partial unique index to enforce single active session per project
  const sqlWorkSessionsUniqueIdx = `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_active_work_session_per_project
    ON jarvis_work_sessions (project_slug)
    WHERE status = 'active';
  `;

  // 3. jarvis_mobile_uploads table
  const sqlMobileUploads = `
    CREATE TABLE IF NOT EXISTS jarvis_mobile_uploads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      file_path TEXT NOT NULL,
      file_type TEXT NOT NULL,
      uploaded_at TIMESTAMPTZ DEFAULT NOW(),
      processed BOOLEAN DEFAULT FALSE,
      caption TEXT,
      language VARCHAR(50)
    );
  `;

  // 4. jarvis_daily_briefs table
  const sqlDailyBriefs = `
    CREATE TABLE IF NOT EXISTS jarvis_daily_briefs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      brief_date DATE UNIQUE NOT NULL,
      raw_brief_markdown TEXT,
      siri_summary TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;

  // 5. jarvis_audit_logs table
  const sqlAuditLogs = `
    CREATE TABLE IF NOT EXISTS jarvis_audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      payload JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;

  // 6. jarvis_auth_tickets table (for single-use tickets)
  const sqlAuthTickets = `
    CREATE TABLE IF NOT EXISTS jarvis_auth_tickets (
      ticket_id TEXT PRIMARY KEY,
      purpose TEXT NOT NULL,
      metadata JSONB DEFAULT '{}'::jsonb,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;

  try {
    await queryDb(sqlWorkSessions);
    await queryDb(sqlWorkSessionsUniqueIdx);
    await queryDb(sqlMobileUploads);
    await queryDb(sqlDailyBriefs);
    await queryDb(sqlAuditLogs);
    await queryDb(sqlAuthTickets);

    // Non-destructive column migrations
    await queryDb("ALTER TABLE jarvis_mobile_uploads ADD COLUMN IF NOT EXISTS caption TEXT;");
    await queryDb("ALTER TABLE jarvis_mobile_uploads ADD COLUMN IF NOT EXISTS language VARCHAR(50);");
    await queryDb("ALTER TABLE jarvis_daily_briefs ADD COLUMN IF NOT EXISTS siri_summary TEXT;");

    console.log('[JarvisMigrations] Database migrations completed successfully.');
    return true;
  } catch (err) {
    console.error('[JarvisMigrations] Error executing migrations:', err.message);
    throw err;
  }
}

module.exports = {
  runMigrations
};
