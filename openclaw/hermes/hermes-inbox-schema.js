/**
 * Validation schema for Hermes Inbox request payloads
 */

const VALID_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

/**
 * Validates the inbox request payload.
 * Throws an Error if validation fails.
 * @param {object} payload
 */
function validateInboxRequestPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload must be an object.');
  }

  // Check requestedBy: can be direct key or fallback to legacy requested_by.telegram_chat_id
  const requestedBy = payload.requestedBy || (payload.requested_by && (payload.requested_by.telegram_chat_id || payload.requested_by.telegram_user_id));
  if (!requestedBy) {
    throw new Error('requestedBy is required.');
  }

  // Check botId: can be direct key or fallback to legacy bot slug
  const botId = payload.botId || payload.bot;
  if (!botId) {
    throw new Error('botId is required.');
  }

  // Check inputSummary: can be direct key or fallback to legacy fields/raw_message
  let inputSummary = payload.inputSummary;
  if (!inputSummary) {
    if (payload.raw_message) {
      inputSummary = payload.raw_message;
    } else if (payload.fields && typeof payload.fields === 'object') {
      inputSummary = Object.entries(payload.fields)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
    }
  }

  if (!inputSummary || String(inputSummary).trim() === '') {
    throw new Error('inputSummary is required.');
  }

  const priority = payload.priority || 'normal';
  if (!VALID_PRIORITIES.includes(priority)) {
    throw new Error(`Invalid priority '${priority}'. Valid priorities: ${VALID_PRIORITIES.join(', ')}`);
  }
}

/**
 * Normalizes the inbox request payload to input matching createHermesJob.
 * @param {object} payload
 * @returns {object} Normalized Hermes job input.
 */
function normalizeInboxRequestToHermesJobInput(payload) {
  validateInboxRequestPayload(payload);

  const requestedBy = String(payload.requestedBy || (payload.requested_by && (payload.requested_by.telegram_chat_id || payload.requested_by.telegram_user_id))).trim();
  const botId = String(payload.botId || payload.bot).trim();
  
  let inputSummary = payload.inputSummary;
  if (!inputSummary) {
    if (payload.raw_message) {
      inputSummary = payload.raw_message;
    } else if (payload.fields && typeof payload.fields === 'object') {
      inputSummary = Object.entries(payload.fields)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
    }
  }
  inputSummary = String(inputSummary).trim();

  const priority = payload.priority || 'normal';
  const force = !!payload.force;
  
  const metadata = {
    ...(payload.metadata || {}),
    ...(payload.fields ? { fields: payload.fields } : {}),
    ...(payload.workflow ? { workflow: payload.workflow } : {}),
    requestId: payload.requestId || null
  };

  return {
    requestedBy,
    botId,
    inputSummary,
    priority,
    force,
    metadata
  };
}

module.exports = {
  validateInboxRequestPayload,
  normalizeInboxRequestToHermesJobInput,
  VALID_PRIORITIES
};
