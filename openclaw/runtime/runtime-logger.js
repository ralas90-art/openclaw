const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot } = require('./bot-loader');

function getLogFilePath() {
  const workspaceRoot = getWorkspaceRoot();
  return path.join(workspaceRoot, 'openclaw', 'runtime', 'logs', 'runtime-events.jsonl');
}

/**
 * Appends a runtime event to the jsonl log.
 * Safe-guarded: never throws exceptions.
 * @param {object} event
 */
function logEvent(event) {
  try {
    const filePath = getLogFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Extract acting chat ID from different possible event properties
    let actingChatId = event.senderChatId || event.chatId || event.requestedByChatId || event.userId;
    
    if (!actingChatId && event.message && typeof event.message === 'object') {
      actingChatId = event.message.chat?.id ? String(event.message.chat.id) : null;
    }
    if (!actingChatId && event.safePayload && event.safePayload.message && typeof event.safePayload.message === 'object') {
      actingChatId = event.safePayload.message.chat?.id ? String(event.safePayload.message.chat.id) : null;
    }

    const logData = {
      timestamp: new Date().toISOString(),
      ...event
    };

    const roles = require('./runtime-roles');
    if (actingChatId) {
      logData.chatIdHash = roles.hashChatIdForLogs(actingChatId);
      logData.userRoleSummary = Array.from(roles.getRolesForChatId(actingChatId)).join(',');
    }

    try {
      const { getCommandPermission, normalizeCommand } = require('./runtime-permissions');
      if (event.command) {
        logData.command = normalizeCommand(event.command);
      }
      const perm = getCommandPermission(logData.command);
      if (perm) {
        logData.commandTier = perm.tier;
        logData.commandCategory = perm.category;
        logData.requiredCapability = perm.capability || null;
        logData.permissionDecision = (event.status === 'failure' && event.errorCategory === 'unauthorized') ? 'denied' : 'allowed';
        if (logData.permissionDecision === 'denied') {
          logData.deniedReason = 'unauthorized';
        }
      }
    } catch (permErr) {}

    // Redact raw chat ID properties and ensure no secrets/paths are saved
    delete logData.senderChatId;
    delete logData.chatId;
    delete logData.requestedByChatId;
    delete logData.userId;
    delete logData.chatIdStr;
    
    if (logData.message && typeof logData.message === 'object') {
      const msgCopy = { ...logData.message };
      if (msgCopy.chat) {
        msgCopy.chat = { ...msgCopy.chat };
        delete msgCopy.chat.id;
      }
      if (msgCopy.from) {
        msgCopy.from = { ...msgCopy.from };
        delete msgCopy.from.id;
      }
      logData.message = msgCopy;
    }
    
    if (logData.safePayload && logData.safePayload.message && typeof logData.safePayload.message === 'object') {
      const msgCopy = { ...logData.safePayload.message };
      if (msgCopy.chat) {
        msgCopy.chat = { ...msgCopy.chat };
        delete msgCopy.chat.id;
      }
      if (msgCopy.from) {
        msgCopy.from = { ...msgCopy.from };
        delete msgCopy.from.id;
      }
      logData.safePayload = {
        ...logData.safePayload,
        message: msgCopy
      };
    }

    fs.appendFileSync(filePath, JSON.stringify(logData) + '\n', 'utf8');

    // Update the Job Index dynamically to prevent circular dependencies
    try {
      const { updateJobIndexFromEvent } = require('./runtime-job-index');
      updateJobIndexFromEvent(logData);
    } catch (indexErr) {
      console.warn(`[runtime-logger] Failed to update job index: ${indexErr.message}`);
    }
  } catch (err) {
    console.warn(`[runtime-logger] Failed to write runtime event log: ${err.message}`);
  }
}

/**
 * Reads the runtime events log file safely.
 * Returns an array of parsed event objects.
 * @param {number|null} limit
 * @returns {object[]}
 */
function readEvents(limit = null) {
  try {
    const filePath = getLogFilePath();
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim() !== '');
    const events = lines.map(line => JSON.parse(line));
    if (limit && events.length > limit) {
      return events.slice(-limit);
    }
    return events;
  } catch (err) {
    console.warn(`[runtime-logger] Failed to read runtime event logs: ${err.message}`);
    return [];
  }
}

module.exports = {
  logEvent,
  readEvents
};
