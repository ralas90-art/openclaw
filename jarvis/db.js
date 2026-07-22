/**
 * Jarvis Shared Database Layer & Boot Migration Engine
 * Centralizes PG pool management and schema migrations.
 */

const { Pool } = require('pg');

const DB_URL = process.env.DATABASE_URL;

let pool = null;

function getPool() {
  if (!pool && DB_URL) {
    pool = new Pool({
      connectionString: DB_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      console.error('[JarvisDB] Unexpected error on idle client:', err.message);
    });
  }
  return pool;
}

/**
 * Shared queryDb interface used by all Jarvis modules.
 */
async function queryDb(sqlText, params = []) {
  if (!process.env.DATABASE_URL) {
    console.warn('[JarvisDB] DATABASE_URL missing. Skipping query.');
    return [];
  }

  const p = getPool();
  if (!p) {
    console.warn('[JarvisDB] Could not initialize database pool.');
    return [];
  }

  try {
    const res = await p.query(sqlText, params);
    return res.rows;
  } catch (err) {
    console.error('[JarvisDB] Query error:', err.message);
    throw err;
  }
}

/**
 * Idempotent Schema Migrations
 */
async function runSchemaMigrations() {
  if (!process.env.DATABASE_URL) {
    console.log('[JarvisDB Migrations] DATABASE_URL not set. Skipping migrations.');
    return;
  }

  console.log('[JarvisDB Migrations] Running boot-time schema migrations...');

  try {
    // 1. Ensure jarvis_work_sessions table
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

    // 2. Correction 1: Deduplicate live work-sessions (active and updated) before creating unique index
    await queryDb(`
      UPDATE jarvis_work_sessions
      SET status = 'completed'
      WHERE id NOT IN (
        SELECT DISTINCT ON (project_slug) id
        FROM jarvis_work_sessions
        WHERE status IN ('active', 'updated')
        ORDER BY project_slug, started_at DESC
      )
      AND status IN ('active', 'updated');
    `);

    await queryDb(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_ws_one_active
      ON jarvis_work_sessions (project_slug)
      WHERE status IN ('active', 'updated');
    `);

    // 3. Ensure mobile uploads extra columns
    await queryDb(`
      CREATE TABLE IF NOT EXISTS jarvis_mobile_uploads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        file_path TEXT,
        caption TEXT,
        language VARCHAR(50),
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await queryDb("ALTER TABLE jarvis_mobile_uploads ADD COLUMN IF NOT EXISTS caption TEXT;");
    await queryDb("ALTER TABLE jarvis_mobile_uploads ADD COLUMN IF NOT EXISTS language VARCHAR(50);");

    // 4. Correction 2: Ensure exact natural language audit table & executed_boolean column
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

    console.log('[JarvisDB Migrations] Migrations completed successfully.');
  } catch (err) {
    console.error('[JarvisDB Migrations] Critical failure during migrations:', err.message);
    throw err;
  }
}

/**
 * Clean pool shutdown for test cleanup or application exit
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  queryDb,
  runSchemaMigrations,
  closePool,
  getPool,
};
