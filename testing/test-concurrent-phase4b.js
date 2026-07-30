/**
 * Deterministic Cross-Process Test Harness for Phase 4B Test Suite
 * Spawns two child Node processes running testing/test-jarvis-phase4b.js concurrently.
 * Verifies exit code 0, 42/42 assertions passed, process-unique namespaces, and 0 database/filesystem leakage.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

function getDbIdentity(urlStr) {
  if (!urlStr) return '';
  try {
    const u = new URL(urlStr);
    return `${u.hostname}:${u.port || '5432'}/${(u.pathname || '').replace(/^\/+/, '')}`.toLowerCase();
  } catch (e) {
    return urlStr.toLowerCase();
  }
}

if (fs.existsSync('.env.local')) {
  require('dotenv').config({ path: '.env.local' });
}
require('dotenv').config();

if (process.env.DATABASE_URL && process.env.TEST_DATABASE_URL && getDbIdentity(process.env.TEST_DATABASE_URL) === getDbIdentity(process.env.DATABASE_URL)) {
  process.env.DATABASE_URL = 'postgresql://production_owner:secret_pass@production-db-host.internal:5432/production_openclaw_db';
}

process.env.NODE_ENV = 'test';

const { fork } = require('child_process');
const { queryDb, closePool } = require('../jarvis/db');

function runChildProcess(scriptPath) {
  return new Promise((resolve) => {
    const child = fork(scriptPath, [], {
      silent: true,
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      resolve({
        pid: child.pid,
        code,
        stdout,
        stderr
      });
    });
  });
}

async function runConcurrentHarness() {
  console.log('🧪 Starting Deterministic Cross-Process Concurrent Phase 4B Test Harness...');

  const targetScript = path.join(__dirname, 'test-jarvis-phase4b.js');

  const startTime = Date.now();
  const [procA, procB] = await Promise.all([
    runChildProcess(targetScript),
    runChildProcess(targetScript)
  ]);
  const durationMs = Date.now() - startTime;

  console.log(`- Process A [PID ${procA.pid}] finished with exit code ${procA.code} in ${durationMs}ms.`);
  console.log(`- Process B [PID ${procB.pid}] finished with exit code ${procB.code} in ${durationMs}ms.`);

  // 1. Check exit codes
  assert.strictEqual(procA.code, 0, `Process A [PID ${procA.pid}] failed with exit code ${procA.code}.\nStderr: ${procA.stderr}`);
  assert.strictEqual(procB.code, 0, `Process B [PID ${procB.pid}] failed with exit code ${procB.code}.\nStderr: ${procB.stderr}`);

  // 2. Check 42 assertions passed
  assert(procA.stdout.includes('ALL 42 OF 42 PHASE 4B ASSERTIONS PASSED PERFECTLY!'), `Process A stdout missing completion marker.\nStdout: ${procA.stdout}`);
  assert(procB.stdout.includes('ALL 42 OF 42 PHASE 4B ASSERTIONS PASSED PERFECTLY!'), `Process B stdout missing completion marker.\nStdout: ${procB.stdout}`);

  // 3. Negative check: forbidden fatal error patterns
  const forbiddenPatterns = [/ENOENT/i, /FATAL/i, /uncaughtException/i, /missing relation/i, /missing column/i];
  const combinedLogs = procA.stdout + procA.stderr + procB.stdout + procB.stderr;

  for (const pattern of forbiddenPatterns) {
    const match = combinedLogs.match(pattern);
    assert(!match, `Forbidden error pattern '${pattern}' found in concurrent test execution logs!`);
  }

  // 4. Extract namespaces from stdout
  const nsMatchA = procA.stdout.match(/namespace \[([^\]]+)\]/);
  const nsMatchB = procB.stdout.match(/namespace \[([^\]]+)\]/);

  assert(nsMatchA && nsMatchA[1], `Process A failed to log its namespace identifier.`);
  assert(nsMatchB && nsMatchB[1], `Process B failed to log its namespace identifier.`);

  const nsA = nsMatchA[1];
  const nsB = nsMatchB[1];

  console.log(`- Verified Process A Namespace: [${nsA}]`);
  console.log(`- Verified Process B Namespace: [${nsB}]`);

  assert.notStrictEqual(nsA, nsB, `Process A and Process B must NOT share the same namespace!`);

  // 5. Verify physical fixture directory isolation & cleanup
  const workspaceRoot = path.resolve(__dirname, '..');
  const dirA = path.join(workspaceRoot, 'openclaw', 'inbox', `temp_test_inventory_${nsA}`);
  const dirB = path.join(workspaceRoot, 'openclaw', 'inbox', `temp_test_inventory_${nsB}`);

  assert(!fs.existsSync(dirA), `Process A fixture directory ${dirA} was NOT cleaned up!`);
  assert(!fs.existsSync(dirB), `Process B fixture directory ${dirB} was NOT cleaned up!`);

  // 6. Verify database row isolation & cleanup
  const escapedNsA = nsA.replace(/_/g, '\\_');
  const escapedNsB = nsB.replace(/_/g, '\\_');

  const rowsA = await queryDb(
    "SELECT COUNT(*)::integer as c FROM jarvis_local_folders WHERE safe_alias LIKE $1 ESCAPE '\\' OR root_fingerprint LIKE $1 ESCAPE '\\';",
    [`%${escapedNsA}%`]
  );
  const rowsB = await queryDb(
    "SELECT COUNT(*)::integer as c FROM jarvis_local_folders WHERE safe_alias LIKE $1 ESCAPE '\\' OR root_fingerprint LIKE $1 ESCAPE '\\';",
    [`%${escapedNsB}%`]
  );

  assert.strictEqual(rowsA[0].c, 0, `Database contains ${rowsA[0].c} uncleaned rows for Process A namespace [${nsA}]!`);
  assert.strictEqual(rowsB[0].c, 0, `Database contains ${rowsB[0].c} uncleaned rows for Process B namespace [${nsB}]!`);

  await closePool();

  console.log('✅ Deterministic Cross-Process Harness Assertion Verification PASSED Perfectly!');
  console.log('🎉 ALL Cross-Process Test Isolation Criteria Satisfied Cleanly!\n');
}

runConcurrentHarness().catch((err) => {
  console.error('\nFATAL CONCURRENT HARNESS FAILURE:', err);
  process.exit(1);
});
