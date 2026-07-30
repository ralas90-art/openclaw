/**
 * Jarvis Local Workstation Executor Daemon — Phase 4C.4
 *
 * Outbound-only workstation daemon process.
 * Communicates strictly via authenticated HTTPS API with the Railway Control Plane.
 *
 * Security & Isolation Constraints:
 * - Strictly ZERO database imports, SQL clients, or database connection strings.
 * - Refuses startup unless JARVIS_LOCAL_EXECUTOR_ENABLED=true.
 * - Authenticates requests via Authorization: Bearer <executor_token>.
 * - Opens NO inbound ports / server listeners.
 * - Resolves local aliases via workstation-only JARVIS_LOCAL_INVENTORY_ROOTS_JSON.
 * - Performs metadata-only traversal via jarvis/workstation-scanner.js.
 */

const {
  scanWorkstationRootLevel1,
  scanWorkstationRootRecursive
} = require('./workstation-scanner');

function isExecutorEnabled() {
  return process.env.JARVIS_LOCAL_EXECUTOR_ENABLED === 'true';
}

function getControlPlaneUrl() {
  const url = process.env.JARVIS_CONTROL_PLANE_URL || 'http://127.0.0.1:3000';
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error('Invalid JARVIS_CONTROL_PLANE_URL scheme. Must be http:// or https://');
  }
  return url.replace(/\/+$/, '');
}

function getExecutorToken() {
  const token = process.env.JARVIS_EXECUTOR_TOKEN;
  if (!token || typeof token !== 'string') {
    throw new Error('JARVIS_EXECUTOR_TOKEN environment variable is missing.');
  }
  return token.trim();
}

/**
 * Worker HTTP API client
 */
async function postToControlPlane(endpoint, payload = {}) {
  const baseUrl = getControlPlaneUrl();
  const token = getExecutorToken();
  const targetUrl = `${baseUrl}${endpoint}`;

  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Control plane HTTP error [${response.status}]: ${text || response.statusText}`);
  }

  return await response.json();
}

/**
 * Executes a single job claim & execution cycle
 */
async function processNextJobCycle() {
  if (!isExecutorEnabled()) {
    return { processed: 0, reason: 'Local executor disabled' };
  }

  const claimRes = await postToControlPlane('/api/jarvis/executor/claim', {});
  if (!claimRes || !claimRes.job) {
    return { processed: 0, reason: 'No jobs claimed' };
  }

  const { job, lease_token } = claimRes;
  const alias = job.root_alias;

  try {
    let scanResult;
    if (job.scan_type === 'recursive') {
      scanResult = scanWorkstationRootRecursive(alias);
    } else {
      scanResult = scanWorkstationRootLevel1(alias);
    }

    await postToControlPlane('/api/jarvis/executor/complete', {
      job_id: job.id,
      lease_token,
      result: scanResult
    });

    return { processed: 1, job_id: job.id, status: 'succeeded' };
  } catch (err) {
    try {
      await postToControlPlane('/api/jarvis/executor/fail', {
        job_id: job.id,
        lease_token,
        error: err.message
      });
    } catch (e) {}
    return { processed: 1, job_id: job.id, status: 'failed', error: err.message };
  }
}

/**
 * Main daemon polling loop entrypoint
 */
if (require.main === module) {
  console.log('[LocalExecutorDaemon] Starting Jarvis Local Workstation Executor Daemon...');

  if (!isExecutorEnabled()) {
    console.error('[LocalExecutorDaemon] Refusing to start: JARVIS_LOCAL_EXECUTOR_ENABLED=true is missing.');
    process.exit(1);
  }

  let pollDelayMs = parseInt(process.env.JARVIS_DAEMON_POLL_INTERVAL_MS || '3000', 10);
  const maxDelayMs = 30000;

  let isRunning = true;

  async function pollLoop() {
    while (isRunning) {
      try {
        const res = await processNextJobCycle();
        if (res.processed > 0) {
          console.log(`[LocalExecutorDaemon] Processed job ${res.job_id} (${res.status}).`);
          pollDelayMs = parseInt(process.env.JARVIS_DAEMON_POLL_INTERVAL_MS || '3000', 10);
        } else {
          pollDelayMs = Math.min(pollDelayMs * 1.5, maxDelayMs);
        }
      } catch (err) {
        console.error('[LocalExecutorDaemon] Error in poll loop:', err.message);
        pollDelayMs = Math.min(pollDelayMs * 2, maxDelayMs);
      }
      const jitter = Math.floor(Math.random() * 500);
      await new Promise(r => setTimeout(r, pollDelayMs + jitter));
    }
  }

  pollLoop();

  process.on('SIGINT', () => {
    isRunning = false;
    console.log('[LocalExecutorDaemon] Daemon stopped cleanly.');
    process.exit(0);
  });
}

module.exports = {
  isExecutorEnabled,
  getControlPlaneUrl,
  getExecutorToken,
  processNextJobCycle
};
