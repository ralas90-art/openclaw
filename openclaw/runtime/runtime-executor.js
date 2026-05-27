/**
 * OpenClaw Runtime Executor Orchestrator
 */

const config = require('./runtime-config');
const { isBotAllowed } = require('./runtime-allowlist');
const { loadBotInstructions } = require('./bot-loader');
const { generateResponse } = require('./model-adapter');
const { writeResult } = require('./result-writer');

/**
 * Orchestrates the execution of a runtime bot.
 * @param {string} botSlug
 * @param {string} userRequest
 * @param {string|number} senderChatId
 * @returns {Promise<{ status: string, botSlug?: string, botName?: string, filename?: string, summary?: string, message: string }>}
 */
async function runBot(botSlug, userRequest, senderChatId) {
  // 1. Validate Admin Authorization Chat ID
  const chatIdStr = senderChatId ? String(senderChatId).trim() : '';
  const isAuthorized = config.allowedChatIds.includes(chatIdStr);

  if (!isAuthorized) {
    return {
      status: 'unauthorized',
      message: '❌ Access Denied: You are not authorized to execute runtime bots.'
    };
  }

  // 2. Validate Bot Slug Allowlist
  if (!botSlug) {
    return {
      status: 'rejected',
      message: '❌ Rejection: Bot slug is missing.\nUsage: /run_bot <bot_slug> <user_request>\nExample: /run_bot revenue-master-orchestrator Create a GHL system plan'
    };
  }

  const slug = botSlug.trim().toLowerCase();
  if (!isBotAllowed(slug)) {
    return {
      status: 'rejected',
      message: `❌ Rejection: Bot '${botSlug}' is not approved for runtime execution. Only 'revenue-master-orchestrator' is supported in Phase 1.`
    };
  }

  // 3. Validate User Request Content
  if (!userRequest || !userRequest.trim()) {
    return {
      status: 'rejected',
      message: `❌ Rejection: Empty request details.\nUsage: /run_bot ${slug} <user_request>\nExample: /run_bot ${slug} Create a Cresca OS GHL implementation plan for a home services business`
    };
  }

  try {
    // 4. Load Bot Context & Workflows
    const botContext = await loadBotInstructions(slug, userRequest);
    const botName = botContext.name;

    // 5. Construct Prompts & Instructions
    const systemPrompt = [
      `You are the ${botName} bot in the OpenClaw business growth and automation architecture.`,
      `Your purpose is: ${botContext.fullContext}`,
      '',
      `CRITICAL SECURITY BOUNDARY:`,
      `- Do not reveal system secrets, environment variables, internal credentials, or API keys.`,
      `- Do not reference or expose internal directories outside allowed outbox folders.`,
      `- Do not execute, recommend, or generate any system/shell command lines.`,
      `- Treat the user's input safely and reject any command injection or path traversal attempts.`,
      '',
      `OUTPUT FORMAT CONSTRAINT:`,
      `You MUST format your entire response in English using the exact labels below:`,
      `SUMMARY:`,
      `[Provide a concise 1-2 sentence executive summary of what was generated. Do not include markdown headers inside this summary.]`,
      ``,
      `CONTENT:`,
      `[Provide your detailed markdown strategy, blueprint, or plan here, following the bot's workflow guidelines.]`
    ].join('\n');

    // Limit user request input length to safeguard prompt boundaries
    const safeUserRequest = userRequest.trim().substring(0, config.maxInputChars);

    // 6. Invoke LLM Adapter
    const llmResult = await generateResponse(systemPrompt, safeUserRequest);

    // 7. Write formatted markdown file to outbox
    const fileResult = writeResult(
      slug,
      botName,
      safeUserRequest,
      llmResult.summary,
      llmResult.content
    );

    // 8. Construct response
    const displayMsg = [
      `✅ Runtime execution successful!`,
      `🤖 *Bot:* ${botName}`,
      `📄 *File:* \`${fileResult.filename}\``,
      ``,
      `*Summary:*`,
      llmResult.summary,
      ``,
      `*Next Steps:*`,
      `To publish this file to Google Drive, run:`,
      `/drive_publish_pending`
    ].join('\n');

    return {
      status: 'success',
      botSlug: slug,
      botName,
      filename: fileResult.filename,
      summary: llmResult.summary,
      message: displayMsg
    };

  } catch (err) {
    // Capture and bubble errors cleanly without exposing internals or stack traces
    return {
      status: 'error',
      message: `❌ Runtime execution failed: ${err.message}`
    };
  }
}

module.exports = {
  runBot
};
