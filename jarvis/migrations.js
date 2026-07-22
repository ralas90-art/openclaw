/**
 * Single Authoritative Database Migration Engine for Jarvis
 * Handles schema initialization and data deduplication idempotently.
 */

const { queryDb } = require('./db');

async function runMigrations() {
  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[JarvisMigrations] DATABASE_URL is missing in production environment. Failing boot.');
    }
    console.warn('[JarvisMigrations] DATABASE_URL not set. Skipping DB migrations in non-production environment.');
    return false;
  }

  console.log('[JarvisMigrations] Running database schema setup and migrations...');

  try {
    // 1. jarvis_work_sessions table
    await queryDb(`
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
    `);

    // 2. Retire obsolete active-only index safely if it exists
    await queryDb(`DROP INDEX IF EXISTS idx_active_work_session_per_project;`);

    // 3. Deduplicate active & updated sessions before creating ux_ws_one_active
    await queryDb(`
      UPDATE jarvis_work_sessions
      SET status = 'completed', ended_at = COALESCE(ended_at, NOW()), updated_at = NOW()
      WHERE id NOT IN (
        SELECT DISTINCT ON (project_slug) id
        FROM jarvis_work_sessions
        WHERE status IN ('active', 'updated')
        ORDER BY project_slug, updated_at DESC, started_at DESC
      )
      AND status IN ('active', 'updated');
    `);

    // 4. Create new unique index covering active AND updated statuses
    await queryDb(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_ws_one_active
      ON jarvis_work_sessions (project_slug)
      WHERE status IN ('active', 'updated');
    `);

    // 5. jarvis_mobile_uploads table & columns
    await queryDb(`
      CREATE TABLE IF NOT EXISTS jarvis_mobile_uploads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        file_path TEXT NOT NULL DEFAULT '',
        file_type TEXT NOT NULL DEFAULT 'text',
        uploaded_at TIMESTAMPTZ DEFAULT NOW(),
        processed BOOLEAN DEFAULT FALSE,
        caption TEXT,
        language VARCHAR(50)
      );
    `);
    await queryDb("ALTER TABLE jarvis_mobile_uploads ADD COLUMN IF NOT EXISTS caption TEXT;");
    await queryDb("ALTER TABLE jarvis_mobile_uploads ADD COLUMN IF NOT EXISTS language VARCHAR(50);");

    // 6. jarvis_daily_briefs table
    await queryDb(`
      CREATE TABLE IF NOT EXISTS jarvis_daily_briefs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        brief_date DATE UNIQUE NOT NULL,
        raw_brief_markdown TEXT,
        siri_summary TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await queryDb("ALTER TABLE jarvis_daily_briefs ADD COLUMN IF NOT EXISTS siri_summary TEXT;");

    // 7. jarvis_audit_logs table
    await queryDb(`
      CREATE TABLE IF NOT EXISTS jarvis_audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        payload JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 8. jarvis_natural_language_logs table
    await queryDb(`
      CREATE TABLE IF NOT EXISTS jarvis_natural_language_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        original_text_sanitized TEXT NOT NULL,
        original_text_hash VARCHAR(64) NOT NULL,
        detected_language VARCHAR(50) NOT NULL,
        interpreted_intent VARCHAR(100) NOT NULL,
        mapped_command VARCHAR(255) NOT NULL,
        confidence DECIMAL(5,2) NOT NULL,
        risk_tier VARCHAR(50) NOT NULL,
        executed_boolean BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        source_chat_id VARCHAR(100)
      );
    `);

    // 9. jarvis_auth_tickets table (for single-use tickets)
    await queryDb(`
      CREATE TABLE IF NOT EXISTS jarvis_auth_tickets (
        ticket_id TEXT PRIMARY KEY,
        purpose TEXT NOT NULL,
        metadata JSONB DEFAULT '{}'::jsonb,
        expires_at TIMESTAMPTZ NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 10. jarvis_sessions table (for dashboard session tokens)
    await queryDb(`
      CREATE TABLE IF NOT EXISTS jarvis_sessions (
        session_token TEXT PRIMARY KEY,
        metadata JSONB DEFAULT '{}'::jsonb,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    console.log('[JarvisMigrations] All database migrations completed successfully.');
    return true;
  } catch (err) {
    console.error('[JarvisMigrations] Migration failed:', err.message);
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`[JarvisMigrations] Production migration failed: ${err.message}`);
    }
    throw err;
  }
}

module.exports = {
  runMigrations
};
