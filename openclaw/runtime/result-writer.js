/**
 * OpenClaw Runtime Result Writer
 */

const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot } = require('./bot-loader');

/**
 * Formats and writes the runtime result to the outbox.
 * @param {string} botSlug
 * @param {string} botName
 * @param {string} userRequest
 * @param {string} summary
 * @param {string} content
 * @returns {{ filename: string, fullPath: string, formattedMarkdown: string }}
 */
function writeResult(botSlug, botName, userRequest, summary, content) {
  // 1. Sanitize bot slug for filename safety
  const safeSlug = botSlug.replace(/[^a-zA-Z0-9_-]/g, '_');

  // 2. Generate date-timestamp in format: YYYY-MM-DD_HH-mm-ss
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const timestamp = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;

  const filename = `${timestamp}_${safeSlug}_runtime_result.md`;

  // 3. Resolve target output directory
  const workspaceRoot = getWorkspaceRoot();
  const targetDir = path.join(workspaceRoot, 'openclaw', 'outbox', 'telegram-responses');

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // 4. Assemble standard markdown content template
  const formattedMarkdown = [
    `# OpenClaw Runtime Result`,
    ``,
    `## Request`,
    userRequest.trim(),
    ``,
    `## Bot Used`,
    `${botSlug} (${botName})`,
    ``,
    `## Summary`,
    summary.trim(),
    ``,
    `## Full Output`,
    content.trim(),
    ``,
    `## Next Steps`,
    `Recommended next command:`,
    `- /drive_publish_pending`,
    `- /drive_latest`
  ].join('\n');

  const fullPath = path.join(targetDir, filename);
  
  // 5. Write to responses directory
  fs.writeFileSync(fullPath, formattedMarkdown, 'utf8');

  return {
    filename,
    fullPath,
    formattedMarkdown
  };
}

module.exports = {
  writeResult
};
