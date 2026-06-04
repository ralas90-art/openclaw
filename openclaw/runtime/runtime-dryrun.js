/**
 * OpenClaw External Action Dry-Run Mode Module
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getWorkspaceRoot } = require('./bot-loader');
const { DRYRUN_ACTION_TYPES } = require('./dryrun-action-types');
const { logEvent } = require('./runtime-logger');

function getDryRunsFilePath() {
  const workspaceRoot = getWorkspaceRoot();
  return path.join(workspaceRoot, 'openclaw', 'runtime', 'logs', 'runtime-dryruns.json');
}

/**
 * Loads all dry-run records safely.
 * @returns {object[]}
 */
function _loadDryRuns() {
  try {
    const file = getDryRunsFilePath();
    if (!fs.existsSync(file)) {
      return [];
    }
    const content = fs.readFileSync(file, 'utf8');
    return JSON.parse(content || '[]');
  } catch (err) {
    console.warn(`[runtime-dryrun] Failed to load dry-runs: ${err.message}`);
    return [];
  }
}

/**
 * Saves all dry-run records safely.
 * @param {object[]} records
 */
function _saveDryRuns(records) {
  try {
    const file = getDryRunsFilePath();
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(file, JSON.stringify(records, null, 2), 'utf8');
  } catch (err) {
    console.warn(`[runtime-dryrun] Failed to save dry-runs: ${err.message}`);
  }
}

/**
 * Generates a unique, filesystem-safe dry-run ID.
 * Format: dry_YYYYMMDD_HHMMSS_<shortRandomId>
 * @returns {string}
 */
function generateDryRunId() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const timestamp = `${year}${month}${day}_${hours}${minutes}${seconds}`;
  const shortRandomId = crypto.randomBytes(3).toString('hex');
  return `dry_${timestamp}_${shortRandomId}`;
}

/**
 * Validates dry-run ID format.
 * @param {string} dryrunId
 * @returns {boolean}
 */
function isValidDryRunId(dryrunId) {
  if (!dryrunId || typeof dryrunId !== 'string') return false;
  const pattern = /^dry_\d{8}_\d{6}_[a-f0-9]{6}$/;
  return pattern.test(dryrunId);
}

/**
 * Lists supported dry-run action types with metadata.
 * @returns {object[]}
 */
function listDryRunTypes() {
  return Object.entries(DRYRUN_ACTION_TYPES).map(([type, spec]) => ({
    actionType: type,
    description: spec.description,
    requiredFields: spec.requiredFields,
    example: spec.example
  }));
}

/**
 * Validates action type.
 * @param {string} actionType
 * @returns {boolean}
 */
function validateDryRunActionType(actionType) {
  if (!actionType) return false;
  return Object.prototype.hasOwnProperty.call(DRYRUN_ACTION_TYPES, actionType.trim());
}

/**
 * Parses request string for fields.
 * Support multiline colons AND comma-separated inline key-values.
 * @param {string} request
 * @returns {object}
 */
function parseFields(request) {
  const fields = {};
  if (!request) return fields;

  // 1. Line-by-line colon check
  const lines = request.split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex !== -1) {
      const key = line.substring(0, colonIndex).trim();
      const val = line.substring(colonIndex + 1).trim();
      if (key && !key.includes(' ') && key.length < 50) {
        fields[key] = val;
      }
    }
  }

  // 2. Fallback regex match (e.g. name: John Doe, email: email@com)
  if (Object.keys(fields).length === 0) {
    const matches = request.matchAll(/(\w+)\s*:\s*([^,\n]+)/g);
    for (const match of matches) {
      fields[match[1]] = match[2].trim();
    }
  }

  return fields;
}

/**
 * Creates dry-run preview and report file.
 * @param {string} actionType
 * @param {string} request
 * @param {object} [options={}]
 * @returns {object} The dry-run record.
 */
function createDryRunPreview(actionType, request, options = {}) {
  const cleanType = actionType.trim();
  if (!validateDryRunActionType(cleanType)) {
    throw new Error(`Invalid action type: '${actionType}'`);
  }

  const spec = DRYRUN_ACTION_TYPES[cleanType];
  const fields = parseFields(request);
  
  // Validate required fields
  const missing = [];
  for (const rf of spec.requiredFields) {
    if (!fields[rf]) {
      missing.push(rf);
    }
  }

  const dryrunId = generateDryRunId();
  const jobId = options.jobId || require('./runtime-job-id').generateRuntimeJobId();
  const botSlug = options.botSlug || 'tech-dryrun';

  const simulatedPayload = spec.generateMockPayload(request, fields);

  // Define date-timestamp for output filename
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const timestamp = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
  const filename = `${timestamp}_${cleanType}_dryrun_result.md`;

  const record = {
    dryrunId,
    jobId,
    actionType: cleanType,
    status: 'DRY_RUN_ONLY',
    externalExecution: false,
    originalRequest: request,
    simulatedPayload,
    validation: {
      success: missing.length === 0,
      missingFields: missing,
      riskNotes: 'Simulation-only mode. No real API request was dispatched.',
      complianceNotes: 'Dry-run payload meets local sanitization standards.'
    },
    filename,
    createdAt: now.toISOString()
  };

  // Write markdown report to outbox
  const reportContent = buildDryRunMarkdown(record);
  const workspaceRoot = getWorkspaceRoot();
  const outboxDir = path.join(workspaceRoot, 'openclaw', 'outbox', 'telegram-responses');
  if (!fs.existsSync(outboxDir)) {
    fs.mkdirSync(outboxDir, { recursive: true });
  }
  fs.writeFileSync(path.join(outboxDir, filename), reportContent, 'utf8');

  // Save to storage
  const list = _loadDryRuns();
  list.push(record);
  _saveDryRuns(list);

  // Update job index
  try {
    const { updateJobIndexFromEvent } = require('./runtime-job-index');
    updateJobIndexFromEvent({
      jobId,
      command: 'dryrun_action',
      botSlug,
      status: 'success',
      filename,
      published: false,
      timestamp: record.createdAt
    });
  } catch (e) {}

  logEvent({
    event: 'dryrun_created',
    dryrunId,
    jobId,
    actionType: cleanType,
    status: 'DRY_RUN_ONLY',
    filename,
    validationSuccess: record.validation.success
  });

  if (!record.validation.success) {
    logEvent({
      event: 'dryrun_validation_failed',
      dryrunId,
      jobId,
      actionType: cleanType,
      missingFields: missing
    });
  }

  return record;
}

/**
 * Retrieves a dry-run record by ID.
 * @param {string} dryrunId
 * @returns {object|null}
 */
function getDryRunRecord(dryrunId) {
  if (!isValidDryRunId(dryrunId)) return null;
  const list = _loadDryRuns();
  return list.find(r => r.dryrunId === dryrunId) || null;
}

/**
 * Returns recent dry-run history.
 * @param {number} limit
 * @returns {object[]}
 */
function getDryRunHistory(limit = 10) {
  const list = _loadDryRuns();
  return list
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

/**
 * Builds standard dry-run report content.
 * @param {object} record
 * @returns {string}
 */
function buildDryRunMarkdown(record) {
  const val = record.validation;
  const missingText = val.missingFields.length > 0
    ? `- Missing required fields: ${val.missingFields.join(', ')}`
    : `- All required fields present.`;

  return [
    `# OpenClaw External Action Dry-Run`,
    ``,
    `## Dry-Run ID`,
    record.dryrunId,
    ``,
    `## Job ID`,
    record.jobId,
    ``,
    `## Action Type`,
    record.actionType,
    ``,
    `## Status`,
    record.status,
    ``,
    `## External Execution`,
    `Disabled. No external API call was made.`,
    ``,
    `## Original Request`,
    record.originalRequest.trim(),
    ``,
    `## Simulated Payload`,
    `\`\`\`json`,
    JSON.stringify(record.simulatedPayload, null, 2),
    `\`\`\``,
    ``,
    `## Validation Checks`,
    missingText,
    `- Risk Notes: ${val.riskNotes}`,
    `- Compliance Notes: ${val.complianceNotes}`,
    ``,
    `## Next Steps`,
    `- Review this dry-run report.`,
    `- Approve only when real execution is enabled in a future version.`,
    `- Current system does not execute external actions.`
  ].join('\n');
}

/**
 * Formats Telegram card response.
 * @param {object} record
 * @returns {string}
 */
function formatDryRunForTelegram(record) {
  const payloadStr = JSON.stringify(record.simulatedPayload, null, 2);
  const truncatedPayload = payloadStr.length > 300 ? payloadStr.substring(0, 300) + '\n...' : payloadStr;
  const validationStatus = record.validation.success ? '✅ PASSED' : '⚠️ FAILED (Missing: ' + record.validation.missingFields.join(', ') + ')';

  return [
    `🧪 *OpenClaw Dry-Run Generated*`,
    ``,
    `• *Dry-Run ID:* \`${record.dryrunId}\``,
    `• *Job ID:* \`${record.jobId}\``,
    `• *Action Type:* \`${record.actionType}\``,
    `• *Status:* \`DRY_RUN_ONLY\``,
    `• *External Execution:* \`Disabled\``,
    `• *Validation:* \`${validationStatus}\``,
    `• *File:* \`${record.filename}\``,
    ``,
    `*Simulated Payload Preview:*`,
    `\`\`\`json`,
    truncatedPayload,
    `\`\`\``,
    ``,
    `*Next commands:*`,
    `• \`/dryrun_info ${record.dryrunId}\` — Inspect details`,
    `• \`/run_job ${record.jobId}\` — View execution trace`,
    `• \`/drive_publish_pending\` — Publish report`
  ].join('\n');
}

module.exports = {
  generateDryRunId,
  isValidDryRunId,
  listDryRunTypes,
  validateDryRunActionType,
  createDryRunPreview,
  getDryRunRecord,
  getDryRunHistory,
  buildDryRunMarkdown,
  formatDryRunForTelegram
};
