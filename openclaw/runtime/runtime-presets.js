const fs = require('fs');
const path = require('path');
const config = require('./runtime-config');
const { getWorkspaceRoot } = require('./bot-loader');
const { generateRuntimeJobId } = require('./runtime-job-id');
const { logEvent: baseLogEvent } = require('./runtime-logger');

let currentSenderChatId = null;

function logEvent(event) {
  baseLogEvent({
    senderChatId: currentSenderChatId,
    ...event
  });
}

// Load drivePublisher dynamically
let drivePublisher;
try {
  drivePublisher = require('../integrations/google-drive-publisher/drive-publisher');
} catch (err) {
  // Graceful fallback
}

/**
 * Loads the runtime presets from runtime-presets.json.
 * @returns {object}
 */
function loadRuntimePresets() {
  try {
    const workspaceRoot = getWorkspaceRoot();
    const presetsPath = path.join(workspaceRoot, 'openclaw', 'runtime', 'runtime-presets.json');
    if (!fs.existsSync(presetsPath)) {
      return {};
    }
    const content = fs.readFileSync(presetsPath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.warn(`[runtime-presets] Failed to load presets: ${err.message}`);
    return {};
  }
}

/**
 * Returns the preset configuration for a given preset ID.
 * @param {string} presetId
 * @returns {object|null}
 */
function getPreset(presetId) {
  const presets = loadRuntimePresets();
  if (presetId && presets[presetId]) {
    return presets[presetId];
  }
  return null;
}

/**
 * Lists all available presets.
 * @returns {object[]}
 */
function listPresets() {
  const presets = loadRuntimePresets();
  return Object.entries(presets).map(([id, config]) => ({
    id,
    ...config
  }));
}

/**
 * Validates whether a preset ID is registered and valid.
 * @param {string} presetId
 * @returns {boolean}
 */
function validatePresetId(presetId) {
  const presets = loadRuntimePresets();
  return !!(presetId && presets[presetId]);
}

/**
 * Replaces placeholders in the template with input safely.
 * @param {object} preset
 * @param {string} input
 * @returns {string}
 */
function renderPresetPrompt(preset, input) {
  if (!preset || !preset.template) return '';
  return preset.template.replace(/\{\{[a-zA-Z0-9_-]+\}\}/g, input.trim());
}

/**
 * Runs a preset bot execution.
 */
async function runPreset(presetId, input, senderChatId, options = {}) {
  currentSenderChatId = senderChatId;
  const startTime = Date.now();
  const jobId = options.jobId || generateRuntimeJobId();

  // 1. Validate Admin Authorization via centralized permission check
  const { requireCommandPermission } = require('./runtime-permissions');
  const permCheck = requireCommandPermission('run_preset', senderChatId);
  const chatIdStr = senderChatId ? String(senderChatId).trim() : 'unknown';

  if (!permCheck.allowed) {
    const errMsg = `❌ Access Denied: You are not authorized to execute preset commands (Your Chat ID: ${chatIdStr}).`;
    logEvent({
      jobId,
      type: 'runtime_execution',
      command: 'run_preset',
      presetId,
      botSlug: null,
      status: 'failure',
      durationMs: Date.now() - startTime,
      errorCategory: 'unauthorized',
      safeMessage: 'Access Denied: You are not authorized to execute preset commands.'
    });
    return {
      status: 'unauthorized',
      jobId,
      message: errMsg
    };
  }

  // 2. Validate Preset ID
  const preset = getPreset(presetId);
  if (!preset) {
    const errMsg = `❌ Rejection: Unknown preset ID '${presetId}'. Use /preset_list to see available options.`;
    logEvent({
      jobId,
      type: 'runtime_execution',
      command: 'run_preset',
      presetId,
      botSlug: null,
      status: 'failure',
      durationMs: Date.now() - startTime,
      errorCategory: 'validation_failed',
      safeMessage: `Rejection: Unknown preset ID '${presetId}'`
    });
    return {
      status: 'rejected',
      jobId,
      message: errMsg
    };
  }

  // 3. Validate input is not empty
  if (!input || !input.trim()) {
    const errMsg = `❌ Rejection: Input parameters cannot be empty.\nUsage: /run_preset ${presetId} <input>\nExample: ${preset.example}`;
    logEvent({
      jobId,
      type: 'runtime_execution',
      command: 'run_preset',
      presetId,
      botSlug: preset.bot,
      status: 'failure',
      durationMs: Date.now() - startTime,
      errorCategory: 'validation_failed',
      safeMessage: 'Rejection: Empty input parameters for preset.'
    });
    return {
      status: 'rejected',
      jobId,
      message: errMsg
    };
  }

  // 4. Render user prompt safely
  const renderedPrompt = renderPresetPrompt(preset, input);

  // 5. Execute using existing runtime executor runBot
  const presetInfo = {
    id: presetId,
    name: preset.name,
    command: 'run_preset'
  };

  try {
    const { runBot } = require('./runtime-executor');
    const execResult = await runBot(preset.bot, renderedPrompt, senderChatId, jobId, presetInfo);
    if (execResult.status !== 'success') {
      return execResult;
    }

    const displayMsg = [
      `✅ Preset execution successful!`,
      `🆔 *Job ID:* \`${jobId}\``,
      `🎯 *Preset:* \`${presetId}\` (${preset.name})`,
      `🤖 *Bot Used:* ${execResult.botName || preset.bot}`,
      `📄 *File:* \`${execResult.filename}\``,
      ``,
      `*Summary:*`,
      execResult.summary,
      ``,
      `*Next Commands:*`,
      `• \`/run_job ${jobId}\` — Inspect job telemetry`,
      `• \`/drive_publish_pending\` — Publish file to Google Drive`
    ].join('\n');

    return {
      status: 'success',
      jobId,
      presetId,
      botSlug: preset.bot,
      filename: execResult.filename,
      summary: execResult.summary,
      message: displayMsg
    };
  } catch (err) {
    logEvent({
      jobId,
      type: 'runtime_execution',
      command: 'run_preset',
      presetId,
      botSlug: preset.bot,
      status: 'failure',
      durationMs: Date.now() - startTime,
      errorCategory: 'internal_error',
      safeMessage: `Preset execution failed: ${err.message}`
    });
    return {
      status: 'error',
      jobId,
      message: `❌ Preset execution failed: ${err.message}`
    };
  }
}

/**
 * Runs a preset bot execution and publishes the output to Google Drive atomically.
 */
async function runPresetPublish(presetId, input, senderChatId, options = {}) {
  currentSenderChatId = senderChatId;
  const startTime = Date.now();
  const jobId = options.jobId || generateRuntimeJobId();

  // 1. Validate Admin Authorization via centralized permission check
  const { requireCommandPermission } = require('./runtime-permissions');
  const permCheck = requireCommandPermission('run_preset_publish', senderChatId);
  const chatIdStr = senderChatId ? String(senderChatId).trim() : 'unknown';

  if (!permCheck.allowed) {
    const errMsg = `❌ Access Denied: You are not authorized to execute preset publishing (Your Chat ID: ${chatIdStr}).`;
    logEvent({
      jobId,
      type: 'runtime_execution',
      command: 'run_preset_publish',
      presetId,
      botSlug: null,
      status: 'failure',
      durationMs: Date.now() - startTime,
      errorCategory: 'unauthorized',
      safeMessage: 'Access Denied: You are not authorized to execute preset publishing.'
    });
    return {
      status: 'unauthorized',
      jobId,
      message: errMsg
    };
  }

  // 2. Validate Preset ID
  const preset = getPreset(presetId);
  if (!preset) {
    const errMsg = `❌ Rejection: Unknown preset ID '${presetId}'. Use /preset_list to see available options.`;
    logEvent({
      jobId,
      type: 'runtime_execution',
      command: 'run_preset_publish',
      presetId,
      botSlug: null,
      status: 'failure',
      durationMs: Date.now() - startTime,
      errorCategory: 'validation_failed',
      safeMessage: `Rejection: Unknown preset ID '${presetId}'`
    });
    return {
      status: 'rejected',
      jobId,
      message: errMsg
    };
  }

  // 3. Validate input is not empty
  if (!input || !input.trim()) {
    const errMsg = `❌ Rejection: Input parameters cannot be empty.\nUsage: /run_preset_publish ${presetId} <input>\nExample: /run_preset_publish ${presetId} Suffolk County NY`;
    logEvent({
      jobId,
      type: 'runtime_execution',
      command: 'run_preset_publish',
      presetId,
      botSlug: preset.bot,
      status: 'failure',
      durationMs: Date.now() - startTime,
      errorCategory: 'validation_failed',
      safeMessage: 'Rejection: Empty input parameters for preset publishing.'
    });
    return {
      status: 'rejected',
      jobId,
      message: errMsg
    };
  }

  // 4. Confirm preset is explicitly allowed for publishing
  if (!preset.allowedPublish) {
    const errMsg = `❌ Rejection: Preset '${presetId}' is not authorized for direct publishing. Only presets configured with allowedPublish=true can use /run_preset_publish.`;
    logEvent({
      jobId,
      type: 'runtime_execution',
      command: 'run_preset_publish',
      presetId,
      botSlug: preset.bot,
      status: 'failure',
      durationMs: Date.now() - startTime,
      errorCategory: 'validation_failed',
      safeMessage: `Rejection: Preset '${presetId}' is not allowed for publishing.`
    });
    return {
      status: 'rejected',
      jobId,
      message: errMsg
    };
  }

  // 5. Render user prompt safely
  const renderedPrompt = renderPresetPrompt(preset, input);

  // 6. Execute using existing runtime executor runBot
  const presetInfo = {
    id: presetId,
    name: preset.name,
    command: 'run_preset_publish'
  };

  let execResult;
  try {
    const { runBot } = require('./runtime-executor');
    execResult = await runBot(preset.bot, renderedPrompt, senderChatId, jobId, presetInfo);
  } catch (err) {
    logEvent({
      jobId,
      type: 'runtime_execution',
      command: 'run_preset_publish',
      presetId,
      botSlug: preset.bot,
      status: 'failure',
      durationMs: Date.now() - startTime,
      errorCategory: 'internal_error',
      safeMessage: `Preset execution failed: ${err.message}`
    });
    return {
      status: 'error',
      jobId,
      message: `❌ Preset execution failed: ${err.message}`
    };
  }

  if (execResult.status !== 'success') {
    return execResult;
  }

  const generatedFilename = execResult.filename;
  const botName = execResult.botName || preset.bot;

  // 7. Resolve workspace root and construct exact file path
  const workspaceRoot = getWorkspaceRoot();
  const responsesDir = path.join(workspaceRoot, 'openclaw', 'outbox', 'telegram-responses');
  const exactFilePath = path.join(responsesDir, generatedFilename);

  // 8. Publish via safe wrapper (drivePublisher.publishExactRuntimeFile)
  let publishResult;
  if (!drivePublisher) {
    const errMsg = `❌ Drive Publisher integration not available. File generated successfully, but could not publish.`;
    logEvent({
      jobId,
      type: 'runtime_execution',
      command: 'run_preset_publish',
      presetId,
      botSlug: preset.bot,
      status: 'failure',
      durationMs: Date.now() - startTime,
      errorCategory: 'google_drive_error',
      safeMessage: 'Drive publisher not loaded.'
    });
    return {
      status: 'error',
      jobId,
      message: errMsg
    };
  }

  try {
    publishResult = await drivePublisher.publishExactRuntimeFile(exactFilePath, { bot: preset.bot, jobId: jobId });
  } catch (err) {
    logEvent({
      jobId,
      type: 'runtime_execution',
      command: 'run_preset_publish',
      presetId,
      botSlug: preset.bot,
      status: 'failure',
      durationMs: Date.now() - startTime,
      errorCategory: 'google_drive_error',
      safeMessage: `Drive publish failed: ${err.message}`
    });
    return {
      status: 'error',
      jobId,
      message: `❌ Drive publish failed: ${err.message}`
    };
  }

  // Handle rejected
  if (publishResult.status === 'rejected') {
    logEvent({
      jobId,
      type: 'runtime_execution',
      command: 'run_preset_publish',
      presetId,
      botSlug: preset.bot,
      status: 'failure',
      durationMs: Date.now() - startTime,
      errorCategory: 'google_drive_error',
      safeMessage: `Drive publish rejected: ${publishResult.error || 'unknown'}`
    });
    return {
      status: 'error',
      jobId,
      message: `❌ Drive publish rejected: ${publishResult.error}`
    };
  }

  // Handle already_published
  if (publishResult.status === 'already_published') {
    const existingLink = publishResult.drive_web_url || publishResult.drive_local_path || '(local copy)';
    logEvent({
      jobId,
      type: 'runtime_execution',
      command: 'run_preset_publish',
      presetId,
      botSlug: preset.bot,
      status: 'success',
      filename: generatedFilename,
      published: true,
      publishStatus: 'already_published',
      duplicateDetected: true,
      driveLink: existingLink,
      durationMs: Date.now() - startTime,
      errorCategory: null,
      safeMessage: null
    });

    const displayMsg = [
      `⚠️ *Already Published — No Duplicate Upload*`,
      ``,
      `🆔 *Job ID:* \`${jobId}\``,
      `🎯 *Preset:* \`${presetId}\` (${preset.name})`,
      `🤖 *Bot:* ${botName}`,
      `📄 *File:* \`${generatedFilename}\``,
      `🔗 *Drive Link:* ${existingLink}`,
      ``,
      `*Summary:*`,
      execResult.summary,
      ``,
      `*Next Commands:*`,
      `• \`/run_job ${jobId}\` — Inspect job telemetry`,
      `• \`/drive_latest\` — View latest published Drive file`
    ].join('\n');

    return {
      status: 'success',
      jobId,
      presetId,
      botSlug: preset.bot,
      filename: generatedFilename,
      summary: execResult.summary,
      driveLink: existingLink,
      message: displayMsg
    };
  }

  // Handle successful publishing
  const driveLink = publishResult.drive_web_url || publishResult.drive_local_path || '(local upload)';
  logEvent({
    jobId,
    type: 'runtime_execution',
    command: 'run_preset_publish',
    presetId,
    botSlug: preset.bot,
    status: 'success',
    filename: generatedFilename,
    published: true,
    publishStatus: 'published',
    duplicateDetected: false,
    driveLink: driveLink,
    durationMs: Date.now() - startTime,
    errorCategory: null,
    safeMessage: null
  });

  const displayMsg = [
    `🚀 *Preset execution & publishing successful!*`,
    ``,
    `🆔 *Job ID:* \`${jobId}\``,
    `🎯 *Preset:* \`${presetId}\` (${preset.name})`,
    `🤖 *Bot:* ${botName}`,
    `📄 *File:* \`${generatedFilename}\``,
    `🔗 *Drive Link:* ${driveLink}`,
    ``,
    `*Summary:*`,
    execResult.summary,
    ``,
    `*Next Commands:*`,
    `• \`/run_job ${jobId}\` — Inspect job telemetry`,
    `• \`/drive_latest\` — View latest published Drive file`
  ].join('\n');

  return {
    status: 'success',
    jobId,
    presetId,
    botSlug: preset.bot,
    filename: generatedFilename,
    summary: execResult.summary,
    driveLink: driveLink,
    message: displayMsg
  };
}

module.exports = {
  loadRuntimePresets,
  getPreset,
  listPresets,
  validatePresetId,
  renderPresetPrompt,
  runPreset,
  runPresetPublish
};
