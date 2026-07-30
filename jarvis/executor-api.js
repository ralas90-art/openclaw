/**
 * Jarvis Control-Plane Executor API — Phase 4C.4R2
 *
 * Dedicated HTTPS Control-Plane API handlers for workstation executor communication.
 * Handles worker authentication (Bearer token + timing-safe equality), atomic job claiming
 * via SELECT FOR UPDATE SKIP LOCKED, lease token generation, lease expiration recovery,
 * chunk staging, and result finalization.
 */

const crypto = require('crypto');
const path = require('path');
const { queryDb, withTransaction } = require('./db');

/**
 * Registers an executor worker and generates a raw token once.
 * Requires admin privilege.
 */
async function registerExecutor(workerId) {
  if (!workerId || typeof workerId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(workerId)) {
    throw new Error('Invalid workerId. Identifier must be alphanumeric.');
  }

  const rawSecret = crypto.randomBytes(32).toString('hex');
  const fullToken = `${workerId}.${rawSecret}`;
  const tokenHash = crypto.createHash('sha256').update(fullToken).digest('hex');

  await queryDb(
    `INSERT INTO jarvis_local_executors (worker_id, auth_token_hash, status, last_heartbeat_at, created_at)
     VALUES ($1, $2, 'active', NOW(), NOW())
     ON CONFLICT (worker_id) DO UPDATE SET
       auth_token_hash = EXCLUDED.auth_token_hash,
       status = 'active',
       last_heartbeat_at = NOW();`,
    [workerId, tokenHash]
  );

  return {
    worker_id: workerId,
    token: fullToken,
    status: 'active'
  };
}

/**
 * Rotates token for an existing worker
 */
async function rotateExecutorToken(workerId) {
  if (!workerId || typeof workerId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(workerId)) {
    throw new Error('Invalid workerId.');
  }

  const rows = await queryDb("SELECT * FROM jarvis_local_executors WHERE worker_id = $1;", [workerId]);
  if (rows.length === 0) {
    throw new Error(`Executor worker '${workerId}' not found.`);
  }

  const rawSecret = crypto.randomBytes(32).toString('hex');
  const fullToken = `${workerId}.${rawSecret}`;
  const tokenHash = crypto.createHash('sha256').update(fullToken).digest('hex');

  await queryDb(
    "UPDATE jarvis_local_executors SET auth_token_hash = $1, status = 'active', last_heartbeat_at = NOW() WHERE worker_id = $2;",
    [tokenHash, workerId]
  );

  return {
    worker_id: workerId,
    token: fullToken,
    status: 'active'
  };
}

/**
 * Disables an executor worker
 */
async function disableExecutor(workerId) {
  const rows = await queryDb(
    "UPDATE jarvis_local_executors SET status = 'disabled' WHERE worker_id = $1 RETURNING *;",
    [workerId]
  );
  if (rows.length === 0) {
    throw new Error(`Executor worker '${workerId}' not found.`);
  }
  return rows[0];
}

/**
 * Revokes an executor worker and cancels active jobs
 */
async function revokeExecutor(workerId) {
  return await withTransaction(async (client) => {
    const rows = await client.query(
      "UPDATE jarvis_local_executors SET status = 'revoked' WHERE worker_id = $1 RETURNING *;",
      [workerId]
    );
    if (rows.rows.length === 0) {
      throw new Error(`Executor worker '${workerId}' not found.`);
    }

    const worker = rows.rows[0];
    await client.query(
      `UPDATE jarvis_local_scan_jobs
       SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
       WHERE executor_id = $1 AND status IN ('queued', 'running');`,
      [worker.id]
    );

    return worker;
  });
}

/**
 * Lists all registered executors (redacting secrets)
 */
async function listExecutors() {
  const rows = await queryDb(
    "SELECT id, worker_id, status, last_heartbeat_at, created_at FROM jarvis_local_executors ORDER BY created_at DESC;"
  );
  return rows;
}

/**
 * Authenticates a worker bearer token using fixed-length timing-safe comparison
 */
async function authenticateWorker(authHeader) {
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    throw new Error('Unauthorized');
  }

  const token = authHeader.substring(7).trim();
  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new Error('Unauthorized');
  }

  const workerId = parts[0];
  const rows = await queryDb(
    "SELECT * FROM jarvis_local_executors WHERE worker_id = $1 AND status = 'active';",
    [workerId]
  );

  if (rows.length === 0) {
    throw new Error('Unauthorized');
  }

  const worker = rows[0];
  const presentedHash = crypto.createHash('sha256').update(token).digest('hex');
  const expectedHash = worker.auth_token_hash;

  const bufA = Buffer.from(presentedHash, 'hex');
  const bufB = Buffer.from(expectedHash, 'hex');

  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    throw new Error('Unauthorized');
  }

  // Update heartbeat
  await queryDb(
    "UPDATE jarvis_local_executors SET last_heartbeat_at = NOW() WHERE id = $1;",
    [worker.id]
  );

  return worker;
}

/**
 * Updates worker heartbeat timestamp
 */
async function sendHeartbeat(worker) {
  await queryDb("UPDATE jarvis_local_executors SET last_heartbeat_at = NOW() WHERE id = $1;", [worker.id]);
  return { success: true, worker_id: worker.worker_id, last_heartbeat_at: new Date().toISOString() };
}

/**
 * Atomic job claim using SELECT FOR UPDATE SKIP LOCKED
 */
async function claimNextJob(worker, leaseSeconds = 60) {
  return await withTransaction(async (client) => {
    // 1. Reclaim expired leases first
    await client.query(`
      UPDATE jarvis_local_scan_jobs
      SET status = 'queued',
          lease_version = lease_version + 1,
          lease_expires_at = NULL,
          lease_token_hash = NULL,
          updated_at = NOW()
      WHERE status = 'running'
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at < NOW();
    `);

    // 2. Select eligible queued job with row lock
    const selRes = await client.query(`
      SELECT j.*
      FROM jarvis_local_scan_jobs j
      JOIN jarvis_local_folders f ON f.safe_alias = j.root_alias
      WHERE j.status = 'queued'
        AND f.status = 'approved'
        AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= NOW())
        AND j.attempt_count < j.max_attempts
      ORDER BY j.created_at ASC
      LIMIT 1
      FOR UPDATE OF j SKIP LOCKED;
    `);

    if (selRes.rows.length === 0) {
      return null;
    }

    const job = selRes.rows[0];

    // Generate raw lease token
    const rawLeaseToken = crypto.randomBytes(32).toString('hex');
    const leaseHash = crypto.createHash('sha256').update(rawLeaseToken).digest('hex');
    const leaseExpires = new Date(Date.now() + leaseSeconds * 1000).toISOString();

    const upRes = await client.query(`
      UPDATE jarvis_local_scan_jobs
      SET status = 'running',
          executor_id = $1,
          attempt_count = attempt_count + 1,
          claimed_at = NOW(),
          started_at = NOW(),
          lease_expires_at = $2,
          lease_version = lease_version + 1,
          lease_token_hash = $3,
          updated_at = NOW()
      WHERE id = $4
      RETURNING *;
    `, [worker.id, leaseExpires, leaseHash, job.id]);

    const updatedJob = upRes.rows[0];
    return {
      job: updatedJob,
      lease_token: rawLeaseToken
    };
  });
}

/**
 * Renews lease for an actively running job
 */
async function renewLease(worker, jobId, rawLeaseToken, leaseSeconds = 60) {
  const rows = await queryDb("SELECT * FROM jarvis_local_scan_jobs WHERE id = $1;", [jobId]);
  if (rows.length === 0) throw new Error(`Job '${jobId}' not found.`);
  const job = rows[0];

  if (job.executor_id !== worker.id) throw new Error('Unauthorized worker for job.');
  if (job.status !== 'running') throw new Error(`Job '${jobId}' is not running.`);
  if (!job.lease_expires_at || new Date(job.lease_expires_at) < new Date()) throw new Error('Lease expired.');
  if (!validateLeaseToken(rawLeaseToken, job.lease_token_hash)) throw new Error('Invalid lease token.');

  const newExpires = new Date(Date.now() + leaseSeconds * 1000).toISOString();
  await queryDb(
    "UPDATE jarvis_local_scan_jobs SET lease_expires_at = $1, updated_at = NOW() WHERE id = $2;",
    [newExpires, jobId]
  );

  return { success: true, job_id: jobId, lease_expires_at: newExpires };
}

/**
 * Validates lease credential token against stored hash
 */
function validateLeaseToken(rawLeaseToken, expectedHash) {
  if (!rawLeaseToken || !expectedHash) return false;
  const presentedHash = crypto.createHash('sha256').update(rawLeaseToken).digest('hex');
  const bufA = Buffer.from(presentedHash, 'hex');
  const bufB = Buffer.from(expectedHash, 'hex');
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Validates file metadata record fields strictly
 */
function validateFileRecord(file) {
  if (!file || typeof file !== 'object') throw new Error('Invalid file record object.');
  const rel = file.relativePath || file.relative_path || '';
  if (!rel || typeof rel !== 'string') throw new Error('Missing relativePath in record.');
  if (rel.includes('\0')) throw new Error('NUL byte in path.');
  if (rel.includes('..')) throw new Error('Path traversal segment (..) in path.');
  if (path.isAbsolute(rel)) throw new Error('Absolute path rejected.');
  if (/^[a-zA-Z]:/.test(rel)) throw new Error('Windows drive-qualified path rejected.');
  if (/^\\\\/.test(rel) || /^\/\//.test(rel)) throw new Error('UNC path rejected.');
  if (/^\\\\?\\/.test(rel)) throw new Error('Extended-length path rejected.');
  if (/[\x00-\x1F\x7F]/.test(rel)) throw new Error('Control character in path.');
  if (rel.length > 500) throw new Error('Relative path exceeds max length.');

  if (file.size !== undefined && file.size !== null) {
    const size = Number(file.size);
    if (!Number.isFinite(size) || size < 0) throw new Error('Invalid file size value.');
  }
}

/**
 * Uploads a chunk of scan metadata records into staging table
 */
async function uploadChunk(worker, jobId, rawLeaseToken, chunkSequence, chunkPayload) {
  const rows = await queryDb("SELECT * FROM jarvis_local_scan_jobs WHERE id = $1;", [jobId]);
  if (rows.length === 0) throw new Error(`Job '${jobId}' not found.`);
  const job = rows[0];

  if (job.executor_id !== worker.id) throw new Error('Unauthorized worker for job.');
  if (job.status !== 'running') throw new Error(`Job '${jobId}' is not running.`);
  if (!job.lease_expires_at || new Date(job.lease_expires_at) < new Date()) throw new Error('Lease expired.');
  if (!validateLeaseToken(rawLeaseToken, job.lease_token_hash)) throw new Error('Invalid lease token.');

  if (!chunkPayload || typeof chunkPayload !== 'object') throw new Error('Invalid chunk payload.');
  const files = Array.isArray(chunkPayload.files) ? chunkPayload.files : [];
  if (files.length > 5000) throw new Error('Chunk file limit exceeded (max 5000).');

  for (const f of files) {
    validateFileRecord(f);
  }

  const seq = parseInt(chunkSequence, 10);
  if (isNaN(seq) || seq < 1) throw new Error('Invalid chunkSequence.');

  await queryDb(
    `INSERT INTO jarvis_local_scan_chunks (job_id, executor_id, lease_version, chunk_sequence, chunk_payload, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (job_id, lease_version, chunk_sequence) DO UPDATE SET
       chunk_payload = EXCLUDED.chunk_payload,
       created_at = NOW();`,
    [jobId, worker.id, job.lease_version, seq, JSON.stringify(chunkPayload)]
  );

  return { success: true, job_id: jobId, chunk_sequence: seq, files_staged: files.length };
}

/**
 * Marks job failed safely
 */
async function failJobApi(worker, jobId, rawLeaseToken, errorMessage) {
  const rows = await queryDb("SELECT * FROM jarvis_local_scan_jobs WHERE id = $1;", [jobId]);
  if (rows.length === 0) throw new Error(`Job '${jobId}' not found.`);
  const job = rows[0];

  if (job.executor_id !== worker.id) throw new Error('Unauthorized worker for job.');
  if (!validateLeaseToken(rawLeaseToken, job.lease_token_hash)) throw new Error('Invalid lease token.');

  const { sanitizeError } = require('./sanitizer');
  const safeErr = sanitizeError(new Error(errorMessage || 'Workstation execution failed'));

  await queryDb(
    `UPDATE jarvis_local_scan_jobs
     SET status = 'failed',
         failed_at = NOW(),
         updated_at = NOW(),
         lease_token_hash = NULL,
         sanitized_error = $1
     WHERE id = $2;`,
    [safeErr, jobId]
  );

  await queryDb("DELETE FROM jarvis_local_scan_chunks WHERE job_id = $1;", [jobId]);

  return { success: true, job_id: jobId, status: 'failed' };
}

/**
 * Gets status summary for an executor worker
 */
async function getExecutorStatusApi(worker) {
  const jobs = await queryDb(
    "SELECT id, root_alias, scan_type, status, claimed_at, updated_at FROM jarvis_local_scan_jobs WHERE executor_id = $1 ORDER BY updated_at DESC LIMIT 10;",
    [worker.id]
  );
  return {
    worker_id: worker.worker_id,
    status: worker.status,
    last_heartbeat_at: worker.last_heartbeat_at,
    active_jobs: jobs
  };
}

module.exports = {
  registerExecutor,
  rotateExecutorToken,
  disableExecutor,
  revokeExecutor,
  listExecutors,
  authenticateWorker,
  sendHeartbeat,
  claimNextJob,
  renewLease,
  validateLeaseToken,
  uploadChunk,
  failJobApi,
  getExecutorStatusApi
};

