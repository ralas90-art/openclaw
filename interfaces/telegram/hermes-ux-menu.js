/**
 * Hermes Telegram UX Menu & Guided Workflows (Phase UX1)
 */

const fs = require('fs');
const path = require('path');

function getStateFilePath() {
  let root = process.env.OPENCLAW_WORKSPACE_ROOT;
  if (!root || !fs.existsSync(path.join(root, 'openclaw'))) {
    root = path.join(__dirname, '../../');
  }
  return path.join(root, 'openclaw', 'runtime', 'data', 'telegram_states.json');
}

function loadStates() {
  const filePath = getStateFilePath();
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveStates(states) {
  const filePath = getStateFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(states, null, 2));
}

function getSessionState(chatId) {
  const states = loadStates();
  return states[String(chatId)] || null;
}

function setSessionState(chatId, state) {
  const states = loadStates();
  states[String(chatId)] = state;
  saveStates(states);
}

function clearSessionState(chatId) {
  const states = loadStates();
  delete states[String(chatId)];
  saveStates(states);
}

/**
 * Main /menu command handler.
 */
function handleMenuCommand(message) {
  const out = `🛠️ *Hermes Operator Control Center*\n\n` +
              `Select an action or workflow option below to get started:`;

  const buttons = [
    [
      { text: "🔍 Find Prospects", callback_data: "menu:find_prospects" },
      { text: "🎯 Today's Cockpit", callback_data: "menu:cockpit_today" }
    ],
    [
      { text: "🧠 Research Prospect", callback_data: "menu:research_prospect" },
      { text: "⭐ Score Prospect", callback_data: "menu:score_prospect" }
    ],
    [
      { text: "✍️ Generate Outreach", callback_data: "menu:generate_outreach" },
      { text: "📬 Review Drafts", callback_data: "menu:review_drafts" }
    ],
    [
      { text: "🔁 Follow-ups Due", callback_data: "menu:followups_due" },
      { text: "📊 Pipeline Status", callback_data: "menu:pipeline_status" }
    ],
    [
      { text: "🖥 Open Dashboard", url: "http://localhost:3300/dashboard/cockpit" }
    ]
  ];

  const response = new String(out);
  response.reply_markup = { inline_keyboard: buttons };
  return response;
}

/**
 * Starts the guided prospecting workflow.
 */
function handleFindProspectsStart(message) {
  const chatId = message.chat?.id;
  if (!chatId) return "❌ Error: Chat ID not found.";

  setSessionState(chatId, { step: 'niche', niche: null, area: null });

  const out = `🔍 *Find Prospects - Step 1: Select Niche*\n\n` +
              `Select the target industry niche below, or choose Custom to specify your own:`;

  const buttons = [
    [
      { text: "Roofing", callback_data: "find:niche:roofing" },
      { text: "Solar", callback_data: "find:niche:solar" }
    ],
    [
      { text: "Cleaning", callback_data: "find:niche:cleaning" },
      { text: "Contractors", callback_data: "find:niche:contractors" }
    ],
    [
      { text: "✍️ Custom Niche", callback_data: "find:niche:custom" }
    ]
  ];

  const response = new String(out);
  response.reply_markup = { inline_keyboard: buttons };
  return response;
}

/**
 * Prompts user for the area selection/input.
 */
function handleFindAreaPrompt(chatId, niche) {
  const out = `🔍 *Find Prospects - Step 2: Select Area*\n\n` +
              `Target Niche: *${niche}*\n\n` +
              `Select the target region area below, or choose Custom to specify your own:`;

  const buttons = [
    [
      { text: "Suffolk County", callback_data: "find:area:suffolk" },
      { text: "N Nassau County", callback_data: "find:area:nassau" }
    ],
    [
      { text: "Long Island", callback_data: "find:area:li" },
      { text: "✍️ Custom Area", callback_data: "find:area:custom" }
    ]
  ];

  const response = new String(out);
  response.reply_markup = { inline_keyboard: buttons };
  return response;
}

/**
 * Executes the prospect search using the collected parameters.
 */
async function executeGuidedSearch(chatId, niche, area, originalMessage) {
  clearSessionState(chatId);

  const query = `${niche} ${area}`;
  const tgHandlers = require('./handlers');
  
  // Call existing /prospect_search logic
  let searchResult;
  try {
    searchResult = await tgHandlers.handleCommand(`/prospect_search ${query}`, originalMessage);
  } catch (err) {
    searchResult = `❌ Error running prospect search: ${err.message}`;
  }

  const buttons = [
    [
      { text: "📋 View Latest", callback_data: "menu:prospect_latest" },
      { text: "🎯 Today's Cockpit", callback_data: "menu:cockpit_today" }
    ],
    [
      { text: "🛠️ Operator Menu", callback_data: "menu:start" }
    ]
  ];

  const response = new String(searchResult);
  response.reply_markup = { inline_keyboard: buttons };
  return response;
}

/**
 * Intercepts text messages during active workflow sessions.
 * Returns a response (String object decorated with reply_markup) or null.
 */
async function handleSessionTextMessage(message) {
  const chatId = message.chat?.id;
  if (!chatId) return null;

  const state = getSessionState(chatId);
  if (!state) return null;

  const text = (message.text || '').trim();
  if (!text) return null;

  if (state.step === 'awaiting_custom_niche') {
    state.niche = text;
    state.step = 'area';
    setSessionState(chatId, state);
    return handleFindAreaPrompt(chatId, text);
  }

  if (state.step === 'awaiting_custom_area') {
    return await executeGuidedSearch(chatId, state.niche, text, message);
  }

  return null;
}

module.exports = {
  handleMenuCommand,
  handleFindProspectsStart,
  handleFindAreaPrompt,
  executeGuidedSearch,
  handleSessionTextMessage,
  getSessionState,
  setSessionState,
  clearSessionState
};
