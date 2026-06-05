const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot } = require('../runtime/bot-loader');
const { normalizeInboxRequestToHermesJobInput } = require('./hermes-inbox-schema');
const engine = require('./hermes-queue-engine');

let intervalId = null;

/**
 * Resolves the absolute path to the inbox directory.
 * @returns {string}
 */
function getInboxDir() {
  return path.join(getWorkspaceRoot(), 'openclaw', 'inbox', 'telegram-requests');
}

/**
 * Ensures that the required inbox folders exist.
 */
function ensureHermesInboxFolders() {
  const inboxDir = getInboxDir();
  const processedDir = path.join(inboxDir, 'processed');
  const rejectedDir = path.join(inboxDir, 'rejected');

  fs.mkdirSync(inboxDir, { recursive: true });
  fs.mkdirSync(processedDir, { recursive: true });
  fs.mkdirSync(rejectedDir, { recursive: true });
}

/**
 * Lists all pending request JSON files in the inbox directory.
 * Excludes subdirectories and hidden files. Sorted oldest-to-newest.
 * @returns {string[]} Absolute file paths.
 */
function listPendingInboxRequestFiles() {
  const inboxDir = getInboxDir();
  if (!fs.existsSync(inboxDir)) return [];

  return fs.readdirSync(inboxDir)
    .filter(f => {
      const fullPath = path.join(inboxDir, f);
      const isFile = fs.statSync(fullPath).isFile();
      return isFile && f.endsWith('.json') && !f.startsWith('.');
    })
    .map(f => path.join(inboxDir, f))
    .sort((a, b) => {
      const statA = fs.statSync(a);
      const statB = fs.statSync(b);
      return statA.mtimeMs - statB.mtimeMs; // Ascending (oldest first)
    });
}

/**
 * Reads and parses a JSON inbox file.
 * @param {string} filePath
 * @returns {object} Parsed JSON payload.
 */
function readInboxRequestFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content);
}

/**
 * Archives a processed request file.
 * @param {string} filePath
 * @param {string} hermesJobId
 * @returns {string} New destination path.
 */
function archiveProcessedInboxFile(filePath, hermesJobId) {
  const inboxDir = getInboxDir();
  const processedDir = path.join(inboxDir, 'processed');
  
  const filename = path.basename(filePath);
  let dest = path.join(processedDir, filename);
  if (fs.existsSync(dest)) {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    dest = path.join(processedDir, `${base}_${Date.now()}${ext}`);
  }

  fs.renameSync(filePath, dest);
  return dest;
}

/**
 * Archives a rejected request file and writes a safe note.
 * @param {string} filePath
 * @param {string} reason
 * @returns {string} New destination path.
 */
function archiveRejectedInboxFile(filePath, reason) {
  const inboxDir = getInboxDir();
  const rejectedDir = path.join(inboxDir, 'rejected');

  const filename = path.basename(filePath);
  let dest = path.join(rejectedDir, filename);
  if (fs.existsSync(dest)) {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    dest = path.join(rejectedDir, `${base}_${Date.now()}${ext}`);
  }

  // Attempt rename (or fallback copy if filesytem lock)
  try {
    fs.renameSync(filePath, dest);
  } catch (err) {
    fs.copyFileSync(filePath, dest);
    try { fs.unlinkSync(filePath); } catch (e) {}
  }

  // Write safe rejection notes companion
  const noteDest = dest + '.reject.txt';
  const cleanReason = String(reason).replace(/[a-zA-Z]:\\[\\\w\s.-]+/g, 'path/').substring(0, 300);
  fs.writeFileSync(noteDest, `Rejection Reason: ${cleanReason}\nRejected At: ${new Date().toISOString()}`);

  return dest;
}

/**
 * Ingests a single inbox request file.
 * @param {string} filePath
 * @param {object} [options]
 * @returns {object} Ingestion result.
 */
function ingestInboxRequestFile(filePath, options = {}) {
  let rawPayload;
  
  // 1. Safe JSON parsing
  try {
    rawPayload = readInboxRequestFile(filePath);
  } catch (err) {
    const archivePath = archiveRejectedInboxFile(filePath, `Invalid JSON syntax: ${err.message}`);
    return {
      ok: false,
      filePath,
      archivePath,
      errorCategory: 'validation',
      safeMessage: `Request file is not valid parseable JSON.`
    };
  }

  // 2. Normalize and validate schema
  let normalizedInput;
  try {
    normalizedInput = normalizeInboxRequestToHermesJobInput(rawPayload);
  } catch (err) {
    const archivePath = archiveRejectedInboxFile(filePath, err.message);
    return {
      ok: false,
      filePath,
      archivePath,
      errorCategory: 'validation',
      safeMessage: err.message
    };
  }

  // 3. Create Hermes Job
  try {
    const job = engine.createHermesJob(normalizedInput);
    const archivePath = archiveProcessedInboxFile(filePath, job.hermesJobId);
    return {
      ok: true,
      filePath,
      archivePath,
      hermesJobId: job.hermesJobId,
      status: 'queued',
      job
    };
  } catch (err) {
    // Duplicate checks, etc.
    const archivePath = archiveRejectedInboxFile(filePath, err.message);
    return {
      ok: false,
      filePath,
      archivePath,
      errorCategory: err.message.includes('duplicate') ? 'duplicate' : 'execution',
      safeMessage: err.message
    };
  }
}

/**
 * Polls the inbox once, processing currently pending files.
 * @param {object} [options]
 * @returns {object} Ingestion summary.
 */
function pollHermesInboxOnce(options = {}) {
  ensureHermesInboxFolders();
  const files = listPendingInboxRequestFiles();
  
  const summary = {
    processed: 0,
    rejected: 0,
    results: []
  };

  for (const file of files) {
    try {
      const res = ingestInboxRequestFile(file, options);
      summary.results.push(res);
      if (res.ok) {
        summary.processed++;
      } else {
        summary.rejected++;
      }
    } catch (err) {
      summary.rejected++;
      // Safe fallback to prevent crash
      try {
        const dest = archiveRejectedInboxFile(file, `Internal poller failure: ${err.message}`);
        summary.results.push({
          ok: false,
          filePath: file,
          archivePath: dest,
          errorCategory: 'internal_error',
          safeMessage: 'An internal error occurred while processing the file.'
        });
      } catch (e) {}
    }
  }

  return summary;
}

/**
 * Starts the loop or executes one-shot inbox poller.
 * @param {object} [options]
 * @returns {any} Interval ID if loop is enabled, otherwise summary.
 */
function startHermesInboxPoller(options = {}) {
  ensureHermesInboxFolders();
  const interval = options.intervalMs || 5000;
  
  if (options.watch || options.loop) {
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(() => {
      try {
        pollHermesInboxOnce(options);
      } catch (err) {}
    }, interval);
    return intervalId;
  }
  
  return pollHermesInboxOnce(options);
}

/**
 * Stops the active polling loop.
 */
function stopHermesInboxPoller() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

module.exports = {
  ensureHermesInboxFolders,
  listPendingInboxRequestFiles,
  readInboxRequestFile,
  archiveProcessedInboxFile,
  archiveRejectedInboxFile,
  ingestInboxRequestFile,
  pollHermesInboxOnce,
  startHermesInboxPoller,
  stopHermesInboxPoller
};
