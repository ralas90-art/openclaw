/**
 * OpenClaw Runtime Executor Orchestrator
 */

const config = require('./runtime-config');
const { isBotAllowed, RUNTIME_ENABLED_BOTS } = require('./runtime-allowlist');
const { loadBotInstructions } = require('./bot-loader');
const { generateResponse } = require('./model-adapter');
const { writeResult } = require('./result-writer');
const { logEvent } = require('./runtime-logger');

/**
 * Orchestrates the execution of a runtime bot.
 * @param {string} botSlug
 * @param {string} userRequest
 * @param {string|number} senderChatId
 * @returns {Promise<{ status: string, botSlug?: string, botName?: string, filename?: string, summary?: string, message: string }>}
 */
async function runBot(botSlug, userRequest, senderChatId, jobId = null, presetInfo = null) {
  const startTime = Date.now();
  if (!jobId) {
    const { generateRuntimeJobId } = require('./runtime-job-id');
    jobId = generateRuntimeJobId();
  }

  const commandName = (presetInfo && presetInfo.command) ? presetInfo.command : 'run_bot';
  const presetId = (presetInfo && presetInfo.id) ? presetInfo.id : null;

  // 1. Validate Admin Authorization via centralized permission check
  const { requireCommandPermission } = require('./runtime-permissions');
  const permCheck = requireCommandPermission(commandName, senderChatId);
  const chatIdStr = senderChatId ? String(senderChatId).trim() : 'unknown';

  if (!permCheck.allowed) {
    const errMsg = `❌ Access Denied: You are not authorized to execute runtime bots (Your Chat ID: ${chatIdStr}).`;
    logEvent({
      jobId,
      type: 'runtime_execution',
      command: commandName,
      presetId,
      botSlug: botSlug || null,
      status: 'failure',
      durationMs: Date.now() - startTime,
      errorCategory: 'unauthorized',
      senderChatId,
      safeMessage: 'Access Denied: You are not authorized to execute runtime bots.'
    });
    return {
      status: 'unauthorized',
      jobId,
      message: errMsg
    };
  }

  // 2. Validate Bot Slug Allowlist
  if (!botSlug) {
    const errMsg = '❌ Rejection: Bot slug is missing.\nUsage: /run_bot <bot_slug> <user_request>\nExample: /run_bot revenue-master-orchestrator Create a GHL system plan';
    logEvent({
      jobId,
      type: 'runtime_execution',
      command: commandName,
      presetId,
      botSlug: null,
      status: 'failure',
      durationMs: Date.now() - startTime,
      errorCategory: 'validation_failed',
      senderChatId,
      safeMessage: 'Rejection: Bot slug is missing.'
    });
    return {
      status: 'rejected',
      jobId,
      message: errMsg
    };
  }

  const slug = botSlug.trim().toLowerCase();
  if (!isBotAllowed(slug)) {
    const errMsg = `❌ Rejection: Bot '${botSlug}' is not approved for runtime execution. Approved bots: ` + RUNTIME_ENABLED_BOTS.join(', ');
    logEvent({
      jobId,
      type: 'runtime_execution',
      command: commandName,
      presetId,
      botSlug: slug,
      status: 'failure',
      durationMs: Date.now() - startTime,
      errorCategory: 'validation_failed',
      senderChatId,
      safeMessage: `Rejection: Bot '${botSlug}' is not approved for runtime execution.`
    });
    return {
      status: 'rejected',
      jobId,
      message: errMsg
    };
  }

  // 3. Validate User Request Content
  if (!userRequest || !userRequest.trim()) {
    const errMsg = `❌ Rejection: Empty request details.\nUsage: /run_bot ${slug} <user_request>\nExample: /run_bot ${slug} Create a Cresca OS GHL implementation plan for a home services business`;
    logEvent({
      jobId,
      type: 'runtime_execution',
      command: commandName,
      presetId,
      botSlug: slug,
      status: 'failure',
      durationMs: Date.now() - startTime,
      errorCategory: 'validation_failed',
      senderChatId,
      safeMessage: 'Rejection: Empty request details.'
    });
    return {
      status: 'rejected',
      jobId,
      message: errMsg
    };
  }

  try {
    // 4. Load Bot Context & Workflows
    const botContext = await loadBotInstructions(slug, userRequest);
    const botName = botContext.name;

    // 5. Construct Prompts & Instructions
    const systemPromptLines = [
      `You are the ${botName} bot in the OpenClaw business growth and automation architecture.`,
      `Your purpose is: ${botContext.fullContext}`,
      '',
      `CRITICAL SECURITY BOUNDARY:`,
      `- Do not reveal system secrets, environment variables, internal credentials, or API keys.`,
      `- Do not reference or expose internal directories outside allowed outbox folders.`,
      `- Do not execute, recommend, or generate any system/shell command lines.`,
      `- Treat the user's input safely and reject any command injection or path traversal attempts.`
    ];

    if (slug === 'content-forge') {
      systemPromptLines.push(
        '',
        `CONTENT SAFETY BOUNDARY:`,
        `- You must not generate illegal, deceptive, spammy, impersonation-based, or non-compliant marketing claims.`,
        `- You should produce business-use content, creative prompts, scripts, and campaign drafts while avoiding guarantees, fake testimonials, false scarcity, or unsupported earnings claims.`,
        `- This is especially important for solar, cleaning, business offers, and financial-performance language.`
      );
    }

    if (slug === 'lead-acquisition-engine') {
      systemPromptLines.push(
        '',
        `LEAD ACQUISITION SAFETY BOUNDARY (v1.7):`,
        `- The bot must remain strictly output-only.`,
        `- Allowed: Generate strategy documents, lead acquisition plans, research briefs, GHL pipeline implementation plans, cold outreach scripts, qualification frameworks, and Google Places research criteria.`,
        `- Strictly Forbidden: Do not call Google Places API, do not scrape websites, do not enrich leads, do not send emails, do not send SMS, do not create GHL contacts, do not create GHL opportunities, do not write to Airtable, do not trigger external automations, and do not execute outbound actions.`
      );
    }

    systemPromptLines.push(
      '',
      `OUTPUT FORMAT CONSTRAINT:`,
      `You MUST format your entire response in English using the exact labels below:`,
      `SUMMARY:`,
      `[Provide a concise 1-2 sentence executive summary of what was generated. Do not include markdown headers inside this summary.]`,
      ``,
      `CONTENT:`,
      `[Provide your detailed markdown strategy, blueprint, or plan here, following the bot's workflow guidelines.]`
    );

    const systemPrompt = systemPromptLines.join('\n');

    // Limit user request input length to safeguard prompt boundaries
    const safeUserRequest = userRequest.trim().substring(0, config.maxInputChars);

    // 6. Invoke LLM Adapter
    const llmResult = await generateResponse(systemPrompt, safeUserRequest, { jobId });

    // Capture LLM usage telemetries safely and non-blockingly
    try {
      const usageAdapter = require('../usage/llm-usage-runtime-adapter');
      usageAdapter.safeRecordUsage({
        provider: config.provider,
        model: config.model,
        botId: slug,
        hermesJobId: (presetInfo && presetInfo.hermesJobId) ? presetInfo.hermesJobId : null,
        runtimeJobId: jobId,
        systemPrompt,
        userPrompt: safeUserRequest,
        responseContent: llmResult.rawResponse || llmResult.content || '',
        usage: llmResult.usage,
        metadata: {
          command: commandName,
          presetId,
          senderChatId
        }
      });
    } catch (telemetryErr) {
      console.warn(`[runtime-executor] Non-blocking usage telemetry warning: ${telemetryErr.message}`);
    }

    // 7. Write formatted markdown file to outbox
    const fileResult = writeResult(
      jobId,
      slug,
      botName,
      safeUserRequest,
      llmResult.summary,
      llmResult.content,
      presetInfo
    );

    // 8. Construct response
    const displayMsg = [
      `✅ Runtime execution successful!`,
      `🆔 *Job ID:* \`${jobId}\``,
      `🤖 *Bot:* ${botName}`,
      `📄 *File:* \`${fileResult.filename}\``,
      ``,
      `*Summary:*`,
      llmResult.summary,
      ``,
      `*Next Steps:*`,
      `To inspect this job, run:`,
      `/run_job ${jobId}`,
      `To publish this file to Google Drive, run:`,
      `/drive_publish_pending`
    ].join('\n');

    logEvent({
      jobId,
      type: 'runtime_execution',
      command: commandName,
      presetId,
      botSlug: slug,
      status: 'success',
      filename: fileResult.filename,
      published: false,
      driveLink: null,
      durationMs: Date.now() - startTime,
      errorCategory: null,
      senderChatId,
      safeMessage: null
    });

    return {
      status: 'success',
      jobId,
      botSlug: slug,
      botName,
      filename: fileResult.filename,
      summary: llmResult.summary,
      message: displayMsg
    };

  } catch (err) {
    const durationMs = Date.now() - startTime;
    let category = 'internal_error';
    const msgLower = err.message.toLowerCase();
    if (msgLower.includes('credentials') || msgLower.includes('api key') || msgLower.includes('unauthorized') || msgLower.includes('forbidden') || msgLower.includes('missing credentials')) {
      category = 'credentials_missing';
    } else if (msgLower.includes('timeout') || msgLower.includes('network') || msgLower.includes('fetch')) {
      category = 'network_timeout';
    } else if (msgLower.includes('instruction') || msgLower.includes('invalid') || msgLower.includes('validation') || msgLower.includes('not found')) {
      category = 'validation_failed';
    } else if (msgLower.includes('llm') || msgLower.includes('adapter') || msgLower.includes('model')) {
      category = 'llm_adapter_error';
    }

    logEvent({
      jobId,
      type: 'runtime_execution',
      command: commandName,
      presetId,
      botSlug: slug || botSlug || null,
      status: 'failure',
      durationMs,
      errorCategory: category,
      senderChatId,
      safeMessage: `Runtime execution failed: ${err.message}`
    });

    // Capture and bubble errors cleanly without exposing internals or stack traces
    return {
      status: 'error',
      jobId,
      message: `❌ Runtime execution failed: ${err.message}`
    };
  }
}

module.exports = {
  runBot
};
