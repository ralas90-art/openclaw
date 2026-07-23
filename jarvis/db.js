/**
 * Jarvis Shared Database Layer
 * Centralizes PG connection pool management, transactions, and delegates migrations to jarvis/migrations.js.
 */

const { Pool } = require('pg');

let pool = null;

function getDbIdentity(connectionString) {
  if (!connectionString || typeof connectionString !== 'string') return '';
  try {
    const parsed = new URL(connectionString);
    return `${parsed.host}${parsed.pathname}`.toLowerCase();
  } catch (err) {
    return connectionString.toLowerCase();
  }
}

function getPool() {
  let dbUrl = process.env.DATABASE_URL;
  
  // In production, NEVER use TEST_DATABASE_URL
  if (process.env.NODE_ENV !== 'production' && process.env.TEST_DATABASE_URL) {
    const testUrl = process.env.TEST_DATABASE_URL.trim();
    if (!testUrl.includes('test_env=isolated') && !testUrl.includes('test')) {
      throw new Error('[JarvisDB] Safety Guard: TEST_DATABASE_URL missing dedicated test-database marker (test_env=isolated or test in DB name).');
    }
    dbUrl = testUrl;
  }

  if (!pool && dbUrl) {
    const isLocalhost = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1');
    pool = new Pool({
      connectionString: dbUrl,
      max: parseInt(process.env.PG_POOL_MAX || '10', 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: isLocalhost ? false : { rejectUnauthorized: false }
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
  if (!process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[JarvisDB] DATABASE_URL missing in production environment.');
    }
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
 * Execute a function within a managed database transaction.
 * @param {Function} callback async (client) => { ... }
 */
async function withTransaction(callback) {
  const p = getPool();
  if (!p) {
    throw new Error('[JarvisDB] Cannot execute transaction: DATABASE_URL missing or pool not initialized.');
  }
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[JarvisDB] Transaction rolled back due to error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Graceful connection pool shutdown
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[JarvisDB] Connection pool closed.');
  }
}

module.exports = {
  queryDb,
  withTransaction,
  closePool
};
