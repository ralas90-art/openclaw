/**
 * OpenClaw Runtime Config Loader
 */

const fs = require('fs');
const path = require('path');

// Dynamically load dotenv if not loaded yet
const dotenvPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(dotenvPath)) {
  require('dotenv').config({ path: dotenvPath });
}

const provider = (process.env.OPENCLAW_MODEL_PROVIDER || 'mock').trim().toLowerCase();

// Determine default model based on provider
let defaultModel = process.env.OPENCLAW_DEFAULT_MODEL || '';
if (!defaultModel) {
  if (provider === 'openai') {
    defaultModel = 'gpt-4o';
  } else if (provider === 'anthropic') {
    defaultModel = 'claude-3-5-sonnet-20241022';
  } else if (provider === 'openrouter') {
    defaultModel = 'google/gemini-2.5-pro';
  } else {
    defaultModel = 'mock-model';
  }
}

// Allowed Admin Chat IDs parsing
const allowedChatIdsStr = process.env.TELEGRAM_ALLOWED_RUNTIME_CHAT_IDS || '';
const allowedChatIds = allowedChatIdsStr
  .split(',')
  .map(id => id.trim())
  .filter(id => id.length > 0);

module.exports = {
  provider,
  model: defaultModel,
  timeoutMs: parseInt(process.env.OPENCLAW_MODEL_TIMEOUT_MS, 10) || 30000,
  maxInputChars: parseInt(process.env.OPENCLAW_MAX_INPUT_CHARS, 10) || 8000,
  maxOutputTokens: parseInt(process.env.OPENCLAW_MAX_OUTPUT_TOKENS, 10) || 4000,
  allowedChatIds,
  
  // API Keys
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  openrouterApiKey: process.env.OPENROUTER_API_KEY || ''
};
