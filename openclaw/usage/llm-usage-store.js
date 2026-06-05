/**
 * OpenClaw LLM Usage Ledger JSON Store
 */

const fs = require('fs');
const path = require('path');

/**
 * Resolves the ledger persistence file path, respecting workspace roots.
 * @returns {string}
 */
function getLedgerFilePath() {
  const root = process.env.OPENCLAW_WORKSPACE_ROOT || path.join(__dirname, '../..');
  return path.resolve(root, 'openclaw', 'usage', 'llm-usage-ledger.json');
}

/**
 * Loads the usage ledger array from the JSON file.
 * @returns {object[]}
 */
function loadLedger() {
  const file = getLedgerFilePath();
  if (!fs.existsSync(file)) {
    return [];
  }
  try {
    const content = fs.readFileSync(file, 'utf8');
    if (!content.trim()) {
      return [];
    }
    return JSON.parse(content);
  } catch (err) {
    console.warn(`[llm-usage-store] Read warning (returning empty ledger): ${err.message}`);
    return [];
  }
}

/**
 * Saves the usage ledger array to the JSON file atomically.
 * @param {object[]} data
 */
function saveLedger(data) {
  const file = getLedgerFilePath();
  const dir = path.dirname(file);
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const tempFile = `${file}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
    
    // Windows rename resilience retry loop
    let retries = 10;
    while (retries > 0) {
      try {
        fs.renameSync(tempFile, file);
        break;
      } catch (renameErr) {
        retries--;
        if (retries === 0) {
          throw renameErr;
        }
        // Wait 10ms synchronously
        const stop = Date.now() + 10;
        while (Date.now() < stop) {}
      }
    }
  } catch (err) {
    // Cleanup temp file if write failed
    if (fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile); } catch (e) {}
    }
    throw new Error(`[llm-usage-store] Write failure: ${err.message}`);
  }
}

module.exports = {
  getLedgerFilePath,
  loadLedger,
  saveLedger
};
