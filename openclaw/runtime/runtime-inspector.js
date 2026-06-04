/**
 * OpenClaw Runtime Inspector
 */

const fs = require('fs');
const path = require('path');
const config = require('./runtime-config');
const { RUNTIME_ENABLED_BOTS } = require('./runtime-allowlist');
const { getWorkspaceRoot } = require('./bot-loader');

// Load drivePublisher dynamically
let drivePublisher;
try {
  drivePublisher = require('../integrations/google-drive-publisher/drive-publisher');
} catch (err) {
  // Graceful fallback
}

/**
 * Returns all result files matching *_runtime_result.md, sorted descending by filename.
 */
function getRuntimeResultFiles() {
  const workspaceRoot = getWorkspaceRoot();
  const responsesDir = path.join(workspaceRoot, 'openclaw', 'outbox', 'telegram-responses');
  if (!fs.existsSync(responsesDir)) return [];

  return fs.readdirSync(responsesDir)
    .filter(f => f.endsWith('_runtime_result.md') && !f.startsWith('.'))
    .sort((a, b) => b.localeCompare(a)); // Descending order (newest first)
}

/**
 * Friendly timestamp formatting from filename
 */
function parseTimestampFromFilename(filename) {
  // Format: YYYY-MM-DD_HH-mm-ss_slug_runtime_result.md
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[1]} ${match[2]}:${match[3]}:${match[4]}`;
  }
  return 'Unknown';
}

/**
 * Parses bot slug from filename
 */
function parseBotSlugFromFilename(filename) {
  const clean = filename.replace(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_/, '');
  return clean.replace(/_runtime_result\.md$/, '');
}

/**
 * Extracts and truncates summary from markdown result
 */
function extractSummaryFromMarkdown(filePath) {
  try {
    if (!fs.existsSync(filePath)) return 'File not found.';
    const content = fs.readFileSync(filePath, 'utf8');
    const marker = '## Summary';
    const idx = content.indexOf(marker);
    if (idx === -1) return 'No summary section found.';
    const sub = content.substring(idx + marker.length).trim();
    const nextHeaderIdx = sub.indexOf('##');
    const summaryText = nextHeaderIdx !== -1 ? sub.substring(0, nextHeaderIdx).trim() : sub;
    
    // Cap output length for safe Telegram formatting (max 200 chars)
    if (summaryText.length > 200) {
      return summaryText.substring(0, 197) + '...';
    }
    return summaryText || 'Empty summary.';
  } catch (err) {
    return 'Error reading summary: ' + err.message;
  }
}

/**
 * /run_status
 */
function getRuntimeStatus() {
  const workspaceRoot = getWorkspaceRoot();
  const results = getRuntimeResultFiles();
  const latestFile = results.length > 0 ? results[0] : 'None';

  return {
    status: 'online',
    modelProvider: config.provider || 'unknown',
    approvedBots: RUNTIME_ENABLED_BOTS,
    outboxResultCount: results.length,
    latestResultFile: latestFile,
    drivePublishMode: 'Manual',
    driveFolderId: process.env.GOOGLE_DRIVE_OUTPUT_FOLDER_ID || 'Not configured'
  };
}

/**
 * /run_latest
 */
function getLatestRuntimeResult() {
  const workspaceRoot = getWorkspaceRoot();
  const results = getRuntimeResultFiles();
  if (results.length === 0) return null;

  const latestFile = results[0];
  const responsesDir = path.join(workspaceRoot, 'openclaw', 'outbox', 'telegram-responses');
  const filePath = path.join(responsesDir, latestFile);

  const slug = parseBotSlugFromFilename(latestFile);
  const timestamp = parseTimestampFromFilename(latestFile);
  const summary = extractSummaryFromMarkdown(filePath);

  return {
    filename: latestFile,
    botSlug: slug,
    timestamp: timestamp,
    summary: summary
  };
}

/**
 * /run_history
 */
function getRuntimeHistory(limit = 5) {
  const workspaceRoot = getWorkspaceRoot();
  const results = getRuntimeResultFiles().slice(0, limit);
  const responsesDir = path.join(workspaceRoot, 'openclaw', 'outbox', 'telegram-responses');

  return results.map(file => {
    const filePath = path.join(responsesDir, file);
    const slug = parseBotSlugFromFilename(file);
    const timestamp = parseTimestampFromFilename(file);
    
    let publishStatus = 'unknown';
    
    if (drivePublisher) {
      try {
        const syncDir = path.join(workspaceRoot, 'openclaw', 'outbox', 'google-drive-sync');
        if (!fs.existsSync(syncDir)) {
          publishStatus = 'unknown';
        } else {
          const check = drivePublisher.checkAlreadyPublished(filePath);
          publishStatus = check.alreadyPublished ? 'published' : 'unpublished';
        }
      } catch (err) {
        publishStatus = 'unknown';
      }
    }

    return {
      filename: file,
      botSlug: slug,
      timestamp: timestamp,
      publishStatus: publishStatus
    };
  });
}

module.exports = {
  getRuntimeStatus,
  getLatestRuntimeResult,
  getRuntimeHistory
};
