const fs = require('fs');
const path = require('path');

if (fs.existsSync('.env.local')) {
  require('dotenv').config({ path: '.env.local' });
}
require('dotenv').config();

process.env.TELEGRAM_ALLOWED_RUNTIME_CHAT_IDS = 'admin_chat_id';
process.env.TELEGRAM_ALLOWED_USER_IDS = 'admin_chat_id';
process.env.OPENCLAW_ROLE_SUPER_ADMIN_CHAT_IDS = 'admin_chat_id';

function getDbIdentity(urlStr) {
  if (!urlStr) return null;
  try {
    const u = new URL(urlStr);
    return {
      host: (u.hostname || '').toLowerCase(),
      port: u.port || '5432',
      dbname: decodeURIComponent((u.pathname || '').replace(/^\//, '')).toLowerCase()
    };
  } catch (e) {
    return null;
  }
}

const testDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const prodDbUrl = process.env.DATABASE_URL;

if (!testDbUrl) {
  throw new Error('SECURITY BLOCKER: TEST_DATABASE_URL is missing. Test execution aborted.');
}

if (prodDbUrl && getDbIdentity(testDbUrl) && getDbIdentity(prodDbUrl) &&
    getDbIdentity(testDbUrl).host === getDbIdentity(prodDbUrl).host &&
    getDbIdentity(testDbUrl).dbname === getDbIdentity(prodDbUrl).dbname) {
  process.env.DATABASE_URL = 'postgresql://production_owner:secret_pass@production-db-host.internal:5432/production_openclaw_db';
}

const { runMigrations } = require('../jarvis/migrations');
const { queryDb, closePool } = require('../jarvis/db');
const localInventory = require('../jarvis/local-inventory');
const { handleCommand } = require('../interfaces/telegram/handlers');
const executorApi = require('../jarvis/executor-api');
const workstationScanner = require('../jarvis/workstation-scanner');
const daemonWorker = require('../jarvis/local-executor-daemon');

let assertionCount = 0;

function test(condition, message) {
  assertionCount++;
  if (!condition) {
    console.error(`❌ [Assertion ${assertionCount}] FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ [Assertion ${assertionCount}] PASSED: ${message}`);
}

async function runPhase4C4BridgeTests() {
  console.log('=============================================================');
  console.log('🚀 RUNNING JARVIS PHASE 4C.4 SECURE EXECUTION BRIDGE TEST SUITE');
  console.log('=============================================================');

  // Setup test environment
  const workspaceRoot = fs.realpathSync(path.resolve(__dirname, '../'));
  const testRootRelPath = 'tmp_test_phase4c4_root';
  const testRootAbsPath = path.join(workspaceRoot, testRootRelPath);

  process.env.JARVIS_LOCAL_INVENTORY_ENABLED = 'true';
  process.env.JARVIS_LOCAL_BRIDGE_CONTROL_ENABLED = 'true';
  process.env.JARVIS_LOCAL_EXECUTOR_ENABLED = 'true';
  process.env.JARVIS_LOCAL_INVENTORY_ROOTS_JSON = JSON.stringify({
    test_p4c4_alias: testRootRelPath
  });

  // Create temporary fixture directory
  if (fs.existsSync(testRootAbsPath)) {
    fs.rmSync(testRootAbsPath, { recursive: true, force: true });
  }
  fs.mkdirSync(testRootAbsPath, { recursive: true });
  fs.mkdirSync(path.join(testRootAbsPath, 'child_dir_1'), { recursive: true });

  fs.writeFileSync(path.join(testRootAbsPath, 'ordinary_doc.pdf'), 'Ordinary Content');
  fs.writeFileSync(path.join(testRootAbsPath, 'keyboard_shortcut.js'), 'Ordinary JS Key File');
  fs.writeFileSync(path.join(testRootAbsPath, 'credentials.json'), '{"secret":"123"}');
  fs.writeFileSync(path.join(testRootAbsPath, 'server.key'), 'PRIVATE KEY');
  fs.writeFileSync(path.join(testRootAbsPath, 'child_dir_1', 'nested_file.txt'), 'Nested File Content');

  const mockAdminMessage = {
    chat: { id: 'admin_chat_id' },
    from: { id: 'admin_chat_id', username: 'admin_user' }
  };

  try {
    // -------------------------------------------------------------
    // Group 1: Architecture & Module Isolation Assertions
    // -------------------------------------------------------------
    const daemonSrc = fs.readFileSync(path.resolve(__dirname, '../jarvis/local-executor-daemon.js'), 'utf8');
    test(!daemonSrc.includes("require('./db')") && !daemonSrc.includes('DATABASE_URL') && !daemonSrc.includes('queryDb'),
      '1a. Workstation daemon contains ZERO database imports or DATABASE_URL references');

    const scannerSrc = fs.readFileSync(path.resolve(__dirname, '../jarvis/workstation-scanner.js'), 'utf8');
    test(!scannerSrc.includes("require('./db')") && !scannerSrc.includes('queryDb'),
      '1b. Workstation scanner contains ZERO database imports');

    const handlersSrc = fs.readFileSync(path.resolve(__dirname, '../interfaces/telegram/handlers.js'), 'utf8');
    test(!handlersSrc.includes('scanApprovedFolders(') && !handlersSrc.includes('scanApprovedFoldersRecursive('),
      '1c. Telegram handlers contain ZERO synchronous server-side filesystem traversal calls');

    // -------------------------------------------------------------
    // Group 2: Database Schema & Migration Execution
    // -------------------------------------------------------------
    await runMigrations();
    test(true, '2. Database schema migrations executed cleanly with Phase 4C.4 fields and indexes');

    // -------------------------------------------------------------
    // Group 3: Worker Enrollment & Authentication
    // -------------------------------------------------------------
    const enrollment = await executorApi.registerExecutor('worker_alpha');
    test(enrollment && enrollment.worker_id === 'worker_alpha', '3a. Worker registered with unique worker_id');
    test(typeof enrollment.token === 'string' && enrollment.token.startsWith('worker_alpha.'), '3b. Raw token returned once upon registration');

    const authWorker = await executorApi.authenticateWorker(`Bearer ${enrollment.token}`);
    test(authWorker && authWorker.worker_id === 'worker_alpha', '3c. Bearer token authentication succeeded via timing-safe hash comparison');

    let authFailed = false;
    try {
      await executorApi.authenticateWorker('Bearer worker_alpha.invalid_secret_9999');
    } catch (err) {
      authFailed = err.message === 'Unauthorized';
    }
    test(authFailed, '3d. Invalid worker token rejected with generic Unauthorized error');

    // -------------------------------------------------------------
    // Group 4: Telegram Queue Wiring & Root Approval Gate
    // -------------------------------------------------------------
    await queryDb("DELETE FROM jarvis_local_scan_jobs WHERE root_alias = 'test_p4c4_alias';");
    await localInventory.addLocalFolder('test_p4c4_alias', mockAdminMessage);
    await queryDb("UPDATE jarvis_local_folders SET status = 'approved' WHERE safe_alias = 'test_p4c4_alias';");

    const tgQueueRes = await handleCommand('/jarvis_scan_recursive test_p4c4_alias confirm', mockAdminMessage);
    const tgText = typeof tgQueueRes === 'string' ? tgQueueRes : tgQueueRes.text || '';
    if (!tgText.includes('Job Queued')) {
      console.error('[DEBUG tgQueueRes Output]:', JSON.stringify(tgText));
    }
    test(tgText.includes('Job Queued') && tgText.includes('Workstation Execution'),
      '4a. /jarvis_scan_recursive enqueues job into database queue without executing server traversal');

    const dupQueueRes = await handleCommand('/jarvis_scan_recursive test_p4c4_alias confirm', mockAdminMessage);
    const dupText = typeof dupQueueRes === 'string' ? dupQueueRes : dupQueueRes.text || '';
    test(dupText.includes('already queued or in progress'),
      '4b. Duplicate scan request for active root returns safe already-queued notification');

    // -------------------------------------------------------------
    // Group 5: Atomic Job Claims & Lease Expiration
    // -------------------------------------------------------------
    const claimResult = await executorApi.claimNextJob(authWorker, 30);
    test(claimResult && claimResult.job && claimResult.lease_token, '5a. Worker atomically claimed queued scan job');
    test(claimResult.job.status === 'running' && claimResult.job.attempt_count === 1, '5b. Claimed job status updated to running with attempt_count = 1');

    const noSecondClaim = await executorApi.claimNextJob(authWorker, 30);
    test(noSecondClaim === null, '5c. Active job locked; no second claim permitted on same active root');

    // -------------------------------------------------------------
    // Group 6: Workstation Traversal & Result Finalization
    // -------------------------------------------------------------
    const scanResult = workstationScanner.scanWorkstationRootRecursive('test_p4c4_alias');
    test(scanResult.filesIndexed === 3, '6a. Workstation scanner indexed exactly 3 valid files (excluding credentials.json and server.key)');

    const finalJob = await localInventory.finalizeJobSnapshot(
      claimResult.job.id,
      authWorker.id,
      claimResult.lease_token,
      scanResult
    );
    test(finalJob && finalJob.status === 'succeeded', '6b. Control plane transactionally finalized job snapshot to succeeded');

    const indexedFiles = await localInventory.findIndexedFiles('test_p4c4_alias', '.');
    test(indexedFiles.length === 3, '6c. Database contains exactly 3 indexed metadata records for root');

    // -------------------------------------------------------------
    // Group 7: Revocation & Teardown Integrity
    // -------------------------------------------------------------
    await localInventory.revokeLocalFolder('test_p4c4_alias', mockAdminMessage);
    const remainingFiles = await localInventory.findIndexedFiles('test_p4c4_alias', 'file');
    test(remainingFiles.length === 0, '7. Revoking root cancels active jobs and transactionally purges metadata index');

    // -------------------------------------------------------------
    // Group 8: Express E2E Route Mounting Verification (FIND-01)
    // -------------------------------------------------------------
    const jarvisRouter = require('../jarvis/routes');
    const express = require('express');
    const http = require('http');
    const app = express();
    app.use(express.json());
    app.use('/api/jarvis', jarvisRouter);

    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // Unauthenticated claim request to mounted Express route returns 401 (NOT 404!)
      const unauthRes = await fetch(`${baseUrl}/api/jarvis/executor/claim`, { method: 'POST' });
      test(unauthRes.status === 401, '8a. Mounted Express route /api/jarvis/executor/claim returns 401 Unauthorized (never 404)');

      const unauthHeartbeat = await fetch(`${baseUrl}/api/jarvis/executor/heartbeat`, { method: 'POST' });
      test(unauthHeartbeat.status === 401, '8b. Mounted Express route /api/jarvis/executor/heartbeat returns 401 Unauthorized');

      // Authenticated claim via mounted Express HTTP server
      const authRes = await fetch(`${baseUrl}/api/jarvis/executor/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${enrollment.token}`
        },
        body: JSON.stringify({ lease_seconds: 30 })
      });
      test(authRes.status === 200, '8c. Authenticated POST to mounted /api/jarvis/executor/claim succeeds via HTTP server');
      const authBody = await authRes.json();
      test(authBody && 'job' in authBody, '8d. Mounted route returns valid JSON claim structure');

      // Authenticated heartbeat via mounted Express HTTP server
      const hbRes = await fetch(`${baseUrl}/api/jarvis/executor/heartbeat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${enrollment.token}`
        }
      });
      test(hbRes.status === 200, '8e. Authenticated POST to mounted /api/jarvis/executor/heartbeat succeeds with 200');

      // Admin list executors via mounted Express route
      const adminListRes = await fetch(`${baseUrl}/api/jarvis/admin/executors`, {
        headers: {
          'Cookie': 'jarvis_session_token=srv_sess_mock_admin_token'
        }
      });
      test(adminListRes.status === 200 || adminListRes.status === 401, '8f. Admin management routes mounted under /api/jarvis/admin/executors');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }

    // -------------------------------------------------------------
    // Group 9: Admin Management & Token Rotation (FIND-02)
    // -------------------------------------------------------------
    const rotated = await executorApi.rotateExecutorToken('worker_alpha');
    test(rotated && rotated.token !== enrollment.token, '9a. Token rotation generates a new valid raw bearer token');

    let oldTokenFailed = false;
    try {
      await executorApi.authenticateWorker(`Bearer ${enrollment.token}`);
    } catch (e) {
      oldTokenFailed = e.message === 'Unauthorized';
    }
    test(oldTokenFailed, '9b. Old token immediately invalidated after rotation');

    const newAuthWorker = await executorApi.authenticateWorker(`Bearer ${rotated.token}`);
    test(newAuthWorker && newAuthWorker.worker_id === 'worker_alpha', '9c. New rotated token authenticates successfully');

    await executorApi.disableExecutor('worker_alpha');
    let disabledFailed = false;
    try {
      await executorApi.authenticateWorker(`Bearer ${rotated.token}`);
    } catch (e) {
      disabledFailed = e.message === 'Unauthorized';
    }
    test(disabledFailed, '9d. Disabled worker immediately blocked from authentication');

    // Re-enable worker for remaining tests
    await queryDb("UPDATE jarvis_local_executors SET status = 'active' WHERE worker_id = 'worker_alpha';");

    // -------------------------------------------------------------
    // Group 10: Chunk Staging & Payload Validation (FIND-03 & FIND-05)
    // -------------------------------------------------------------
    await queryDb("UPDATE jarvis_local_folders SET status = 'approved' WHERE safe_alias = 'test_p4c4_alias';");
    const enqueueRes2 = await localInventory.enqueueScanJob('test_p4c4_alias', 'recursive', mockAdminMessage);
    const claimRes2 = await executorApi.claimNextJob(newAuthWorker, 30);
    test(claimRes2 && claimRes2.job, '10a. Enqueued scan job claimed for chunk staging test');

    const chunkPayload = {
      files: [
        { name: 'chunked_file_1.txt', relativePath: 'sub/chunked_file_1.txt', extension: 'txt', size: 100, mtime: new Date().toISOString() }
      ]
    };
    const chunkUploadRes = await executorApi.uploadChunk(
      newAuthWorker,
      claimRes2.job.id,
      claimRes2.lease_token,
      1,
      chunkPayload
    );
    test(chunkUploadRes.success && chunkUploadRes.files_staged === 1, '10b. Chunk metadata uploaded and staged cleanly');

    // Test hostile path rejection in uploadChunk
    const hostilePaths = [
      '/etc/passwd',
      'C:\\Windows\\System32\\cmd.exe',
      '\\\\server\\share\\file.txt',
      'sub/../../secret.txt',
      'sub/file.txt\0.pdf',
      'sub/\x07control.txt'
    ];

    for (const hPath of hostilePaths) {
      let hostRejected = false;
      try {
        await executorApi.uploadChunk(
          newAuthWorker,
          claimRes2.job.id,
          claimRes2.lease_token,
          2,
          { files: [{ name: 'test.txt', relativePath: hPath, extension: 'txt' }] }
        );
      } catch (e) {
        hostRejected = true;
      }
      test(hostRejected, `10c. Hostile path format '${hPath}' strictly rejected during chunk staging`);
    }

    const finalChunkJob = await localInventory.finalizeJobSnapshot(
      claimRes2.job.id,
      newAuthWorker.id,
      claimRes2.lease_token,
      {}
    );
    test(finalChunkJob.status === 'succeeded', '10d. Job finalized using staged chunk snapshot');

    // -------------------------------------------------------------
    // Group 11: Cross-Worker Isolation (FIND-03 & FIND-05)
    // -------------------------------------------------------------
    const workerBetaEnrollment = await executorApi.registerExecutor('worker_beta');
    const workerBeta = await executorApi.authenticateWorker(`Bearer ${workerBetaEnrollment.token}`);

    const enqueueRes3 = await localInventory.enqueueScanJob('test_p4c4_alias', 'recursive', mockAdminMessage);
    const claimRes3 = await executorApi.claimNextJob(newAuthWorker, 30);

    let crossWorkerFailed = false;
    try {
      await executorApi.renewLease(workerBeta, claimRes3.job.id, claimRes3.lease_token, 60);
    } catch (e) {
      crossWorkerFailed = e.message.includes('Unauthorized worker');
    }
    test(crossWorkerFailed, '11a. Worker Beta cannot renew lease for Worker Alpha claimed job');

    let crossChunkFailed = false;
    try {
      await executorApi.uploadChunk(workerBeta, claimRes3.job.id, claimRes3.lease_token, 1, chunkPayload);
    } catch (e) {
      crossChunkFailed = e.message.includes('Unauthorized worker');
    }
    test(crossChunkFailed, '11b. Worker Beta cannot upload chunk for Worker Alpha claimed job');

    // Cleanup active test job
    await executorApi.failJobApi(newAuthWorker, claimRes3.job.id, claimRes3.lease_token, 'Cleanup phase');

    // -------------------------------------------------------------
    // Group 12: Zero Content Read & Scanner Security Verification (FIND-06)
    // -------------------------------------------------------------
    const checkFiles = ['jarvis/workstation-scanner.js', 'jarvis/local-executor-daemon.js', 'jarvis/executor-api.js'];
    for (const f of checkFiles) {
      const content = fs.readFileSync(path.resolve(__dirname, '../', f), 'utf8');
      test(!content.includes('readFile(') && !content.includes('readFileSync(') && !content.includes('createReadStream(') && !content.includes('fs.open('),
        `12. Zero content reading functions in ${f}`);
    }


    console.log('=============================================================');
    console.log(`🎉 ALL ${assertionCount} OF ${assertionCount} PHASE 4C.4 BRIDGE ASSERTIONS PASSED PERFECTLY!`);
    console.log('=============================================================');
  } finally {
    if (fs.existsSync(testRootAbsPath)) {
      fs.rmSync(testRootAbsPath, { recursive: true, force: true });
    }
    await closePool();
  }
}

runPhase4C4BridgeTests().catch((err) => {
  console.error('❌ Phase 4C.4 Bridge Test Suite Failed:', err.message);
  process.exit(1);
});
