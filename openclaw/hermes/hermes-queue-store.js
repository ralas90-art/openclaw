/**
 * OpenClaw Hermes Queue Store Persistence Layer
 */

const fs = require('fs');
const path = require('path');

/**
 * Resolves the queue persistence file path, respecting workspace roots.
 */
function getQueueFilePath() {
  const root = process.env.OPENCLAW_WORKSPACE_ROOT || path.join(__dirname, '../..');
  return path.resolve(root, 'openclaw', 'hermes', 'data', 'hermes-queue.json');
}

/**
 * Loads the queue database from the JSON file. Returns a key-value dictionary of jobs.
 * @returns {Record<string, object>}
 */
function loadQueue() {
  const file = getQueueFilePath();
  if (!fs.existsSync(file)) {
    return {};
  }
  try {
    const content = fs.readFileSync(file, 'utf8');
    if (!content.trim()) {
      return {};
    }
    return JSON.parse(content);
  } catch (err) {
    console.warn(`[hermes-queue-store] Read warning (returning empty queue): ${err.message}`);
    return {};
  }
}

/**
 * Saves the queue database to the JSON file atomically using a temporary file lock.
 * @param {Record<string, object>} data
 */
function saveQueue(data) {
  const file = getQueueFilePath();
  const dir = path.dirname(file);
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const tempFile = `${file}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempFile, file);
  } catch (err) {
    // Cleanup temp file if write failed
    if (fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile); } catch (e) {}
    }
    throw new Error(`[hermes-queue-store] Write failure: ${err.message}`);
  }
}

module.exports = {
  getQueueFilePath,
  loadQueue,
  saveQueue
};
