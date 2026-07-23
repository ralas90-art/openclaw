/**
 * Single Authoritative Database Migration Engine for Jarvis
 * Handles schema initialization, data deduplication, and table creation idempotently with PostgreSQL transaction advisory lock protection.
 */

const { withTransaction } = require('./db');

async function runMigrations() {
  const dbUrl = (process.env.NODE_ENV !== 'production' && process.env.TEST_DATABASE_URL) ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
  if (!dbUrl) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[JarvisMigrations] DATABASE_URL is missing in production environment. Failing boot.');
    }
    console.warn('[JarvisMigrations] DATABASE_URL not set. Skipping DB migrations in non-production environment.');
    return false;
  }

  console.log('[JarvisMigrations] Running database schema setup and migrations with advisory lock protection...');

  try {
    return await withTransaction(async (client) => {
      // 0. Acquire PostgreSQL transaction-level advisory lock to block multi-instance Railway deployment races
      await client.query('SELECT pg_advisory_xact_lock(847291);');

      // 1. jarvis_work_sessions table
      await client.query(`
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
      await client.query(`DROP INDEX IF EXISTS idx_active_work_session_per_project;`);

      // 3. Deduplicate active & updated sessions before creating ux_ws_one_active
      await client.query(`
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
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS ux_ws_one_active
        ON jarvis_work_sessions (project_slug)
        WHERE status IN ('active', 'updated');
      `);

      // 5. jarvis_mobile_uploads table & columns
      await client.query(`
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
      await client.query("ALTER TABLE jarvis_mobile_uploads ADD COLUMN IF NOT EXISTS caption TEXT;");
      await client.query("ALTER TABLE jarvis_mobile_uploads ADD COLUMN IF NOT EXISTS language VARCHAR(50);");

      // 6. jarvis_daily_briefs table
      await client.query(`
        CREATE TABLE IF NOT EXISTS jarvis_daily_briefs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          brief_date DATE UNIQUE NOT NULL,
          raw_brief_markdown TEXT,
          siri_summary TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await client.query("ALTER TABLE jarvis_daily_briefs ADD COLUMN IF NOT EXISTS siri_summary TEXT;");

      // 7. jarvis_audit_logs table
      await client.query(`
        CREATE TABLE IF NOT EXISTS jarvis_audit_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          actor TEXT NOT NULL,
          action TEXT NOT NULL,
          payload JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      // 8. jarvis_natural_language_logs table
      await client.query(`
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

      // 9. jarvis_auth_tickets table (for single-use tickets - SHA-256 hashed)
      await client.query(`
        CREATE TABLE IF NOT EXISTS jarvis_auth_tickets (
          ticket_id TEXT PRIMARY KEY,
          ticket_hash VARCHAR(64),
          purpose TEXT NOT NULL,
          metadata JSONB DEFAULT '{}'::jsonb,
          expires_at TIMESTAMPTZ NOT NULL,
          used BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await client.query("ALTER TABLE jarvis_auth_tickets ADD COLUMN IF NOT EXISTS ticket_hash VARCHAR(64);");
      await client.query("CREATE INDEX IF NOT EXISTS idx_jarvis_auth_tickets_hash ON jarvis_auth_tickets (ticket_hash);");
      await client.query("UPDATE jarvis_auth_tickets SET used = TRUE WHERE ticket_hash IS NULL;");

      // 10. jarvis_sessions table (for dashboard session tokens - SHA-256 hashed)
      await client.query(`
        CREATE TABLE IF NOT EXISTS jarvis_sessions (
          session_token TEXT PRIMARY KEY,
          token_hash VARCHAR(64),
          metadata JSONB DEFAULT '{}'::jsonb,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await client.query("ALTER TABLE jarvis_sessions ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64);");
      await client.query("CREATE INDEX IF NOT EXISTS idx_jarvis_sessions_hash ON jarvis_sessions (token_hash);");
      await client.query("DELETE FROM jarvis_sessions WHERE token_hash IS NULL;");

      // 11. jarvis_projects table
      await client.query(`
        CREATE TABLE IF NOT EXISTS jarvis_projects (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          slug TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          phase TEXT DEFAULT 'planning',
          primary_objective TEXT,
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      // 12. jarvis_approval_requests & audit events
      await client.query(`
        CREATE TABLE IF NOT EXISTS jarvis_approval_requests (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          project_slug TEXT NOT NULL,
          requested_action TEXT NOT NULL,
          risk_level TEXT NOT NULL DEFAULT 'medium',
          status TEXT NOT NULL DEFAULT 'pending',
          action_type TEXT,
          priority_id TEXT,
          source_type TEXT,
          source_id TEXT,
          proposed_payload JSONB DEFAULT '{}',
          expires_at TIMESTAMPTZ,
          proposed_at TIMESTAMPTZ DEFAULT NOW(),
          rejected_at TIMESTAMPTZ,
          cancelled_at TIMESTAMPTZ,
          expired_at TIMESTAMPTZ,
          executed_by TEXT,
          source_priority_id TEXT,
          action_result_summary TEXT,
          execution_error_summary TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await client.query("ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS action_type TEXT;");
      await client.query("ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS priority_id TEXT;");
      await client.query("ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS source_type TEXT;");
      await client.query("ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS source_id TEXT;");
      await client.query("ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS proposed_payload JSONB DEFAULT '{}';");
      await client.query("ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;");
      await client.query("ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS proposed_at TIMESTAMPTZ DEFAULT NOW();");
      await client.query("ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;");
      await client.query("ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;");
      await client.query("ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;");
      await client.query("ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS executed_by TEXT;");
      await client.query("ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS source_priority_id TEXT;");
      await client.query("ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS action_result_summary TEXT;");
      await client.query("ALTER TABLE jarvis_approval_requests ADD COLUMN IF NOT EXISTS execution_error_summary TEXT;");

      await client.query(`
        CREATE TABLE IF NOT EXISTS jarvis_approval_audit_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          approval_id UUID NOT NULL,
          event_type TEXT NOT NULL,
          actor TEXT NOT NULL,
          safe_summary TEXT,
          payload JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      // 13. jarvis_connectors, tokens & sync logs
      await client.query(`
        CREATE TABLE IF NOT EXISTS jarvis_connectors (
          connector_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'Configured',
          read_permissions TEXT[] DEFAULT '{}',
          write_permissions TEXT[] DEFAULT '{}',
          last_used_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS jarvis_connector_tokens (
          connector_id TEXT PRIMARY KEY,
          client_id TEXT,
          client_secret TEXT,
          refresh_token TEXT,
          rotation_status TEXT NOT NULL DEFAULT 'active',
          last_sync_status TEXT NOT NULL DEFAULT 'idle',
          last_used_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS jarvis_connector_sync_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          connector_id TEXT NOT NULL,
          sync_status TEXT NOT NULL,
          records_processed INTEGER DEFAULT 0,
          safe_error_summary TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      await client.query("ALTER TABLE jarvis_mobile_uploads ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;");
      await client.query("ALTER TABLE jarvis_mobile_uploads ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;");

      // 14. Local Inventory & Feedback
      await client.query(`
        CREATE TABLE IF NOT EXISTS jarvis_local_folders (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          folder_path TEXT UNIQUE NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          approved_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS jarvis_local_file_index (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          folder_id UUID REFERENCES jarvis_local_folders(id) ON DELETE CASCADE,
          file_path TEXT UNIQUE NOT NULL,
          file_name TEXT NOT NULL,
          file_extension TEXT,
          file_size_bytes BIGINT,
          modified_at TIMESTAMPTZ,
          indexed_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS jarvis_brief_feedback (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          brief_id UUID,
          brief_date VARCHAR(50),
          feedback_type VARCHAR(50),
          rating VARCHAR(10),
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await client.query("ALTER TABLE jarvis_brief_feedback ADD COLUMN IF NOT EXISTS brief_date VARCHAR(50);");
      await client.query("ALTER TABLE jarvis_brief_feedback ADD COLUMN IF NOT EXISTS feedback_type VARCHAR(50);");
      await client.query("ALTER TABLE jarvis_brief_feedback ADD COLUMN IF NOT EXISTS rating VARCHAR(10);");
      await client.query("ALTER TABLE jarvis_brief_feedback ADD COLUMN IF NOT EXISTS notes TEXT;");
      await client.query("CREATE UNIQUE INDEX IF NOT EXISTS ux_brief_feedback ON jarvis_brief_feedback (brief_date, feedback_type);");

      await client.query(`
        CREATE TABLE IF NOT EXISTS jarvis_priority_feedback (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          priority_id VARCHAR(255) NOT NULL,
          feedback_type VARCHAR(50),
          user_feedback TEXT,
          score INTEGER,
          reason TEXT,
          project_slug VARCHAR(100),
          action VARCHAR(20),
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await client.query("ALTER TABLE jarvis_priority_feedback ADD COLUMN IF NOT EXISTS feedback_type VARCHAR(50);");
      await client.query("ALTER TABLE jarvis_priority_feedback ADD COLUMN IF NOT EXISTS user_feedback TEXT;");
      await client.query("ALTER TABLE jarvis_priority_feedback ADD COLUMN IF NOT EXISTS score INTEGER;");
      await client.query("ALTER TABLE jarvis_priority_feedback ADD COLUMN IF NOT EXISTS reason TEXT;");
      await client.query("ALTER TABLE jarvis_priority_feedback ADD COLUMN IF NOT EXISTS project_slug VARCHAR(100);");
      await client.query("CREATE UNIQUE INDEX IF NOT EXISTS ux_priority_feedback ON jarvis_priority_feedback (priority_id, feedback_type);");

      console.log('[JarvisMigrations] All database migrations completed successfully.');
      return true;
    });
  } catch (err) {
    console.error('[JarvisMigrations] Migration failed:', err.message);
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`[JarvisMigrations] Production migration failed: ${err.message}`);
    }
    throw err;
  }
}

module.exports = {
  runMigrations,
  runSchemaMigrations: runMigrations
};
