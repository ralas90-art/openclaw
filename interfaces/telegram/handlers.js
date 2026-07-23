const { routeNaturalLanguageCommand, markNaturalLanguageLogExecuted } = require('../../jarvis/natural-language-router');
const { supabase } = require('../../lib/supabase');
const runtimeGovernor = require('../../core/coordination/runtimeGovernor');
const circuitBreakerRegistry = require('../../core/failover/circuitBreakerRegistry');
const { replayEvent } = require('../../core/replay/replayManager');
const fs = require('fs');
const path = require('path');
const drivePublisher = require('../../openclaw/integrations/google-drive-publisher/drive-publisher');
const runtimeExecutor = require('../../openclaw/runtime/runtime-executor');
const { getPublicBaseUrl } = require('../../lib/get-public-base-url');

// ------------------------------------------
// Registry & Bot Routing
// ------------------------------------------

function getRegistryPath() {
  const envPath = process.env.OPENCLAW_WORKSPACE_ROOT;
  if (envPath) {
    const candidate = path.join(envPath, 'openclaw', 'bots', 'registry.md');
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(__dirname, '../../', 'openclaw', 'bots', 'registry.md');
}

function parseRegistry() {
  const registryPath = getRegistryPath();
  const bots = { active_runtime: [], active_queue_only: [], documented: [] };
  
  if (!fs.existsSync(registryPath)) return bots;

  const content = fs.readFileSync(registryPath, 'utf8');
  let currentSection = null;

  const lines = content.split('\n');
  for (const line of lines) {
    if (line.includes('## Active Runtime Bots')) currentSection = 'active_runtime';
    else if (line.includes('## Active Queue-Only Bots')) currentSection = 'active_queue_only';
    else if (line.includes('## Documented Only Bots')) currentSection = 'documented';
    else if (line.startsWith('## ')) currentSection = null;

    if (currentSection && line.trim().startsWith('|') && !line.includes('Bot Name')) {
      const parts = line.split('|').map(s => s.trim());
      if (parts.length > 2) {
        const name = parts[1];
        const slugMatch = parts[2].match(/`([^`]+)`/);
        const slug = slugMatch ? slugMatch[1] : null;
        if (slug) {
          bots[currentSection].push({ name, slug });
        }
      }
    }
  }
  return bots;
}

function checkBotStatus(slug) {
  const registry = parseRegistry();
  if (registry.active_runtime.find(b => b.slug === slug)) return 'active_runtime';
  if (registry.active_queue_only.find(b => b.slug === slug)) return 'active_queue_only';
  if (registry.documented.find(b => b.slug === slug)) return 'documented';
  return 'unknown';
}

function parseMultilineCommand(text) {
  const lines = text.trim().split('\n');
  const firstLine = lines[0].trim();
  const parts = firstLine.split(' ');
  const command = parts[0].toLowerCase();
  const workflow = parts.slice(1).join('-').replace(/_/g, '-');

  const fields = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const colonIndex = line.indexOf(':');
    if (colonIndex !== -1) {
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      fields[key] = value;
    }
  }
  return { command, workflow, fields };
}

function getInboxDir() {
  let rootDir = process.env.OPENCLAW_WORKSPACE_ROOT;
  if (!rootDir || !fs.existsSync(path.join(rootDir, 'openclaw'))) {
    rootDir = path.join(__dirname, '../../');
  }
  return path.join(rootDir, 'openclaw', 'inbox', 'telegram-requests');
}

function getInboxFiles() {
  const inboxDir = getInboxDir();
  if (!fs.existsSync(inboxDir)) return [];
  
  const filePattern = /^telegram_[A-Za-z0-9._-]+\.json$/;
  const files = fs.readdirSync(inboxDir).filter(f => filePattern.test(f));
  
  const fileInfos = files.map(filename => {
    const fullPath = path.join(inboxDir, filename);
    let mtime = 0;
    try {
      mtime = fs.statSync(fullPath).mtimeMs;
    } catch (e) {}
    return { filename, fullPath, mtime };
  });
  
  fileInfos.sort((a, b) => {
    if (b.mtime !== a.mtime) {
      return b.mtime - a.mtime;
    }
    return b.filename.localeCompare(a.filename);
  });
  
  return fileInfos;
}

function getManualStepGuideline(bot, workflow) {
  const b = bot.toLowerCase();
  const w = workflow.toLowerCase().replace(/_/g, '-');

  if (b === 'content-forge') {
    if (w === 'image-prompts') {
      return "Generate the selected prompt in Google Flow, save the output to: 03-generated-images/\nThen send:\n/cf video_prompt\nCampaign: [campaign name]\nSelected Image: [filename]\nDuration: 8 seconds\nPlatform: Instagram Reels\nCTA: Book a Demo";
    } else if (w === 'video-prompt') {
      return "Generate the video in Veo/Gemini and save to 05-generated-videos/. Then run /cf qa_video.";
    }
  }

  if (b === 'revenue-master-orchestrator') {
    if (w === 'system-design') {
      return "Review system design inputs. Run Antigravity using offer-engine-builder / sales-process-optimizer / ghl-revenue-automation-builder to generate revenue-blueprint.md under /campaigns/{brand}/revenue-strategy/.";
    } else if (w === 'offer-design') {
      return "Develop premium offer structure. Run offer-engine-builder skill to generate offer-design.md under /campaigns/{brand}/revenue-strategy/.";
    } else if (w === 'ghl-setup') {
      return "Review CRM mapping inputs. Run ghl-revenue-automation-builder to write crm-mapping-manifest.md under /campaigns/{brand}/revenue-strategy/.";
    }
  }

  if (b === 'system-master-orchestrator') {
    if (w === 'build-app') {
      return "Analyze UI layout requirements. Run brand-ux-consistency-auditor or custom code templates to write build-blueprint.md under /openclaw/reports/system-builds/.";
    } else if (w === 'deploy') {
      return "Run branch build check and TS validations. Use publish-github-vercel to deploy to staging. Smoke test routes and generate deployment-smoke-test-report.md under /openclaw/reports/system-builds/.";
    } else if (w === 'fix-bug') {
      return "Trace stack trace details. Run repo-fix-pr-deploy to repair issues and generate bug-fix-walkthrough.md under /openclaw/reports/system-builds/.";
    }
  }

  if (b === 'cresca-content-aeo-engine') {
    if (w === 'optimize-page') {
      return "Rewrite landing page content. Run content-generation-engine (MANDATORY: Claude copywriting) to write optimized-page-copy.md under /campaigns/{brand}/content-aeo/.";
    } else if (w === 'faq-schema') {
      return "Develop FAQ direct-answers and validate JSON-LD code. Run notebooklm-research-extractor to populate schema details. Generate aeo-faq-schema.json under /campaigns/{brand}/content-aeo/.";
    }
  }

  if (b === 'lead-acquisition-engine') {
    if (w === 'icp-define') {
      return "Review ICP criteria. Run lead-acquisition-engine to generate prospect-icp-profile.md under /campaigns/{brand}/lead-acquisition/.";
    } else if (w === 'prospect') {
      return "Source and qualify prospects using intent signals. Run lead-acquisition-engine to build qualified-lead-list.csv under /campaigns/{brand}/lead-acquisition/.";
    } else if (w === 'scripts') {
      return "Write personalized outreach messages. Run lead-acquisition-engine to generate outreach-script-pack.md under /campaigns/{brand}/lead-acquisition/.";
    }
  }

  if (b === 'revenue-optimization-engine') {
    if (w === 'audit') {
      return "Perform funnel leakage analysis. Run revenue-optimization-engine and ghl-config-auditor to generate funnel-leak-audit-report.md under /campaigns/{brand}/revenue-optimization/.";
    } else if (w === 'speed-lead') {
      return "Review time-to-contact statistics. Run ghl-revenue-automation-builder to design the GHL speed-to-lead sequence and generate speed-to-lead-blueprint.md under /campaigns/{brand}/revenue-optimization/.";
    }
  }

  if (b === 'weekly-command-center') {
    if (w === 'review') {
      return "Compile weekly scorecards. Run weekly-command-center to output weekly-performance-snapshot.md and bottlenecks-and-opportunities-report.md under /openclaw/reports/weekly-summaries/.";
    } else if (w === 'plan') {
      return "Define team milestones. Run weekly-command-center to generate weekly-execution-plan.md under /openclaw/reports/weekly-summaries/.";
    }
  }

  if (b === 'client-value-maximizer') {
    if (w === 'upsell') {
      return "Design backend monetization upgrades. Run client-value-maximizer to write customer-lifecycle-monetization-map.md under /campaigns/{brand}/client-value/.";
    } else if (w === 'reactivate') {
      return "Review database lists. Run client-value-maximizer and ghl-revenue-automation-builder to draft SMS/Email sequences and write reactivation-campaign-copy.md under /campaigns/{brand}/client-value/.";
    } else if (w === 'referral') {
      return "Map referral triggers. Run client-value-maximizer to update client-onboarding-manifest.md under /campaigns/{brand}/client-value/.";
    }
  }

  if (b === 'auto-loop-system') {
    if (w === 'review') {
      return "Inspect optimization logs. Run auto-loop-system to generate system-optimization-trend-report.md and corrective-action-routing-manifest.md under /openclaw/reports/auto-loops/.";
    } else if (w === 'setup') {
      return "Initialize optimization loop. Run auto-loop-system to write compounding-progress-log.md under /openclaw/reports/auto-loops/.";
    }
  }

  return null;
}

async function saveToInbox(bot, workflow, fields, message) {
  const inboxDir = getInboxDir();
  if (!fs.existsSync(inboxDir)) {
    fs.mkdirSync(inboxDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `telegram_${timestamp}_${bot}_${workflow}.json`;
  
  const payload = {
    source: "telegram",
    status: "queued",
    bot: bot,
    workflow: workflow,
    fields: fields,
    requested_by: {
      telegram_user_id: message.from?.id?.toString() || "",
      telegram_username: message.from?.username || "",
      telegram_chat_id: message.chat?.id?.toString() || ""
    },
    raw_message: message.text || "",
    timestamp: new Date().toISOString()
  };

  const manualStep = getManualStepGuideline(bot, workflow);
  if (manualStep) {
    payload.next_manual_step = manualStep;
  }

  fs.writeFileSync(path.join(inboxDir, filename), JSON.stringify(payload, null, 2));
  return payload;
}

async function handleInbox() {
  const files = getInboxFiles();
  if (files.length === 0) {
    return `OpenClaw Inbox is empty.\n\nSend a Content Forge command such as:\n\n/cf image_prompts\nProject: SeptiVolt\nCampaign: Batch 001 Founder Demo Ad\nPrompt Count: 5\nAspect Ratio: 9:16\nGoal: Create Google Flow image prompts`;
  }
  
  let response = `OpenClaw Inbox — Latest Requests\n\n`;
  const recentFiles = files.slice(0, 5);
  
  recentFiles.forEach((fileInfo, index) => {
    let details = ``;
    try {
      const data = JSON.parse(fs.readFileSync(fileInfo.fullPath, 'utf8'));
      const bot = data.bot || 'unknown';
      const workflow = data.workflow || 'unknown';
      const project = data.fields?.Project || data.fields?.project || 'none';
      const campaign = data.fields?.Campaign || data.fields?.campaign || 'none';
      const status = data.status || 'queued';
      
      details = `${index + 1}. ${fileInfo.filename}\nBot: ${bot}\nWorkflow: ${workflow}\nProject: ${project}\nCampaign: ${campaign}\nStatus: ${status}`;
    } catch (err) {
      details = `${index + 1}. ${fileInfo.filename}\n[Error: Could not parse request file]`;
    }
    response += details + `\n\n`;
  });
  
  return response.trim();
}

async function handleInboxLatest() {
  const files = getInboxFiles();
  if (files.length === 0) {
    return `OpenClaw Inbox is empty.\n\nSend a Content Forge command such as:\n\n/cf image_prompts\nProject: SeptiVolt\nCampaign: Batch 001 Founder Demo Ad\nPrompt Count: 5\nAspect Ratio: 9:16\nGoal: Create Google Flow image prompts`;
  }
  
  const latestFile = files[0];
  let response = `Latest OpenClaw Request\n\n`;
  
  try {
    const data = JSON.parse(fs.readFileSync(latestFile.fullPath, 'utf8'));
    const bot = data.bot || 'unknown';
    const workflow = data.workflow || 'unknown';
    const fields = data.fields || {};
    const nextStep = data.next_manual_step || 'Review this request in Antigravity and run Content Forge.';
    
    response += `File: ${latestFile.filename}\n`;
    response += `Bot: ${bot}\n`;
    response += `Workflow: ${workflow}\n`;
    
    for (const [key, value] of Object.entries(fields)) {
      response += `${key}: ${value}\n`;
    }
    
    response += `\nNext step:\n${nextStep}`;
  } catch (err) {
    response += `File: ${latestFile.filename}\n[Error: Could not parse request file]`;
  }
  
  return response.trim();
}

async function handleInboxRead(filename) {
  if (!filename) {
    return `Usage: /inbox_read <filename>`;
  }
  
  const base = path.basename(filename);
  if (filename !== base) {
    return `❌ Access denied: Path traversal or invalid characters detected.`;
  }
  
  const filePattern = /^telegram_[A-Za-z0-9._-]+\.json$/;
  if (!filePattern.test(base)) {
    return `❌ Access denied: Invalid filename format or non-JSON extension. Only .json files matching the request pattern are allowed.`;
  }
  
  const inboxDir = getInboxDir();
  const fullPath = path.join(inboxDir, base);
  
  if (!fs.existsSync(fullPath)) {
    return `❌ File not found.`;
  }
  
  try {
    const rawContent = fs.readFileSync(fullPath, 'utf8');
    const data = JSON.parse(rawContent);
    
    const safePayload = {
      filename: base,
      status: data.status || 'queued',
      bot: data.bot || 'unknown',
      workflow: data.workflow || 'unknown',
      fields: data.fields || {},
      requested_by: data.requested_by || {},
      timestamp: data.timestamp || 'unknown',
      next_manual_step: data.next_manual_step || 'None'
    };
    
    let output = `OpenClaw Request Details — ${base}\n\n`;
    output += `Status: ${safePayload.status}\n`;
    output += `Bot: ${safePayload.bot}\n`;
    output += `Workflow: ${safePayload.workflow}\n`;
    output += `Timestamp: ${safePayload.timestamp}\n\n`;
    
    output += `--- Fields ---\n`;
    for (const [key, value] of Object.entries(safePayload.fields)) {
      output += `${key}: ${value}\n`;
    }
    output += `\n`;
    
    output += `--- Requested By ---\n`;
    output += `User ID: ${safePayload.requested_by.telegram_user_id || 'unknown'}\n`;
    output += `Username: @${safePayload.requested_by.telegram_username || 'unknown'}\n`;
    output += `Chat ID: ${safePayload.requested_by.telegram_chat_id || 'unknown'}\n\n`;
    
    output += `--- Next Manual Step ---\n`;
    output += `${safePayload.next_manual_step}\n`;
    
    if (output.length > 4000) {
      output = output.substring(0, 3950) + `\n\n... [Output truncated to avoid Telegram message size limit]`;
    }
    
    return output;
  } catch (err) {
    return `❌ Could not parse request file.`;
  }
}

// ------------------------------------------
async function dispatchCommand(text, message) {
  if (!text || typeof text !== 'string') {
    return { ok: false, text: '❌ Invalid command input.' };
  }

  let pendingLogId = null;
  let textToExecute = text.trim();

  if (!textToExecute.startsWith('/')) {
    const nlResult = await routeNaturalLanguageCommand(textToExecute, message);
    console.log(`[Telegram Handlers] nl_intent_detected=${nlResult.intent || 'unknown'}`);
    console.log(`[Telegram Handlers] mapped_command=${nlResult.command || 'none'}`);
    
    if (nlResult.type === 'error') {
      return { ok: false, text: nlResult.text, logId: null };
    }

    if (nlResult.logId) {
      pendingLogId = nlResult.logId;
    }

    if (nlResult.type === 'reply') {
      const isOk = !nlResult.text.includes('🤔 No entendí') && !nlResult.text.includes('⚠️ *Acción Bloqueada*') && !nlResult.text.includes('⚠️ *Protected Action*') && !nlResult.text.includes('Which project should I save this under?');
      if (isOk && pendingLogId) {
        try {
          await markNaturalLanguageLogExecuted(pendingLogId);
        } catch (auditErr) {
          console.error('[Telegram Handlers] Audit log execution marking failed:', auditErr.message);
        }
      }
      return { ok: isOk, text: nlResult.text, logId: pendingLogId };
    }

    if (nlResult.type === 'command') {
      textToExecute = nlResult.command;
    }
  }

  try {
    const output = await handleCommand(textToExecute, message);
    const isUnknown = !output || typeof output !== 'string' || output.includes('Unknown command') || output.includes('🤔 No entendí');
    const isDenied = output && (output.includes('🚫 Permission Denied') || output.includes('Acción Bloqueada') || output.includes('Protected Action') || output.startsWith('❌'));
    
    const ok = !isUnknown && !isDenied;

    if (ok && pendingLogId) {
      try {
        await markNaturalLanguageLogExecuted(pendingLogId);
      } catch (auditErr) {
        console.error('[Telegram Handlers] Audit log execution marking failed:', auditErr.message);
      }
    }

    return { ok, text: output || 'Unknown command', logId: pendingLogId };
  } catch (err) {
    console.error('[Dispatch Error]', err.message);
    return { ok: false, text: `❌ Execution error: ${err.message}`, logId: pendingLogId };
  }
}

async function handleJarvisDashboard(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_dashboard', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_dashboard', permCheck.reason, message);
  }

  const { createAuthTicket } = require('../../jarvis/auth-tickets');
  const ticket = await createAuthTicket('dashboard_access', { user_id: message ? (message.chat?.id || message.from?.id) : 'unknown' }, 300);
  const publicUrl = getPublicBaseUrl();
  const dashboardUrl = `${publicUrl}/admin/jarvis?ticket=${ticket}`;
  return `📊 *Jarvis Dashboard Access*\n\nHere is your single-use dashboard access link (valid for 5 minutes):\n${dashboardUrl}\n\n⚠️ *Security Note*: This link can only be used once. Token exchange happens automatically on load.`;
}

async function handleCommand(text, message) {
  if (!text) return;

  const parsed = parseMultilineCommand(text);
  const command = parsed.command;

  // 1. Registry & Help Commands
  if (command === '/help') return handleHelp();
  if (command === '/menu') {
    const { handleMenuCommand } = require('./hermes-ux-menu');
    return handleMenuCommand(message);
  }
  if (command === '/jarvis_dashboard' || command === '/jarvisdashboard') {
    return await handleJarvisDashboard(message);
  }

  // Jarvis Personal Assistant Commands
  if (command === '/jarvis_brief' || command === '/jarvisbrief') {
    return await handleJarvisBrief(message);
  }
  if (command === '/jarvis_yesterday' || command === '/jarvisyesterday') {
    return await handleJarvisYesterday(message);
  }
  if (command === '/jarvis_project' || command === '/jarvisproject') {
    const slug = text.trim().split(/\s+/)[1];
    return await handleJarvisProject(slug, message);
  }
  if (command === '/jarvis_next' || command === '/jarvisnext') {
    return await handleJarvisNext(message);
  }
  if (command === '/jarvis_mobile_inbox' || command === '/jarvismobileinbox') {
    const parts = text.trim().split(/\s+/);
    const filter = parts[1];
    return await handleJarvisMobileInbox(filter, message);
  }
  if (command === '/jarvis_mark_processed' || command === '/jarvismarkprocessed') {
    const parts = text.trim().split(/\s+/);
    const uploadId = parts[1];
    return await handleJarvisMarkProcessed(uploadId, message);
  }
  if (command === '/jarvis_process_inbox' || command === '/jarvisprocessinbox') {
    const parts = text.trim().split(/\s+/);
    const uploadId = parts[1];
    const projectSlug = parts[2];
    return await handleJarvisProcessInbox(uploadId, projectSlug, message);
  }
  if (command === '/jarvis_process_latest' || command === '/jarvisprocesslatest') {
    const parts = text.trim().split(/\s+/);
    const projectSlug = parts[1];
    return await handleJarvisProcessLatest(projectSlug, message);
  }
  if (command === '/jarvis_archive_processed' || command === '/jarvisarchiveprocessed') {
    return await handleJarvisArchiveProcessed(message);
  }
  if (command === '/jarvis_session_start' || command === '/jarvissessionstart') {
    const parts = text.trim().split(/\s+/);
    const slug = parts[1];
    const textContent = text.substring(command.length + (slug ? slug.length + 1 : 0)).trim();
    return await handleJarvisSessionStart(slug, textContent, message);
  }
  if (command === '/jarvis_session_update' || command === '/jarvissessionupdate') {
    const parts = text.trim().split(/\s+/);
    const slug = parts[1];
    const summary = text.substring(command.length + (slug ? slug.length + 1 : 0)).trim();
    return await handleJarvisSessionUpdate(slug, summary, message);
  }
  if (command === '/jarvis_session_done' || command === '/jarvissessiondone') {
    const parts = text.trim().split(/\s+/);
    const slug = parts[1];
    const summary = text.substring(command.length + (slug ? slug.length + 1 : 0)).trim();
    return await handleJarvisSessionDone(slug, summary, message);
  }
  if (command === '/jarvis_session_status' || command === '/jarvissessionstatus') {
    return await handleJarvisSessionStatus(message);
  }
  if (command === '/jarvis_session_latest' || command === '/jarvissessionlatest') {
    return await handleJarvisSessionLatest(message);
  }
  if (command === '/jarvis_session_project' || command === '/jarvissessionproject') {
    const parts = text.trim().split(/\s+/);
    const slug = parts[1];
    return await handleJarvisSessionProject(slug, message);
  }
  if (command === '/jarvis_ingest_handoff' || command === '/jarvisingesthandoff') {
    return await handleJarvisIngestHandoff(message);
  }
  if (command === '/jarvis_folders' || command === '/jarvisfolders') {
    const parts = text.trim().split(/\s+/);
    const filter = parts[1];
    return await handleJarvisFolders(filter, message);
  }
  if (command === '/jarvis_add_folder' || command === '/jarvisaddfolder') {
    const folderPath = text.substring(command.length).trim();
    return await handleJarvisAddFolder(folderPath, message);
  }
  if (command === '/jarvis_approve_folder' || command === '/jarvisapprovefolder') {
    const idOrPath = text.substring(command.length).trim();
    return await handleJarvisApproveFolder(idOrPath, message);
  }
  if (command === '/jarvis_scan' || command === '/jarvisscan') {
    return await handleJarvisScan(message);
  }
  if (command === '/jarvis_files' || command === '/jarvisfiles') {
    const parts = text.trim().split(/\s+/);
    const filter = parts[1];
    const arg = parts[2];
    return await handleJarvisFiles(filter, arg, message);
  }
  if (command === '/jarvis_connectors' || command === '/jarvisconnectors') {
    return await handleJarvisConnectors(message);
  }
  if (command === '/jarvis_email_summary' || command === '/jarvisemailsummary') {
    return await handleJarvisEmailSummary(message);
  }
  if (command === '/jarvis_drive_recent' || command === '/jarvisdriverecent') {
    return await handleJarvisDriveRecent(message);
  }
  if (command === '/jarvis_reconnect_google' || command === '/jarvisreconnectgoogle') {
    const args = text.substring(command.length).trim();
    return await handleJarvisReconnectGoogle(args, message);
  }
  if (command === '/jarvis_priorities' || command === '/jarvispriorities') {
    const parts = text.trim().split(/\s+/);
    const filter = parts[1];
    const arg = parts.slice(2).join(' ');
    return await handleJarvisPriorities(filter, arg, message);
  }
  if (command === '/jarvis_followups' || command === '/jarvisfollowups') {
    return await handleJarvisFollowups(message);
  }
  if (command === '/jarvis_blockers' || command === '/jarvisblockers') {
    return await handleJarvisBlockersCmd(message);
  }
  if (command === '/jarvis_brief_good' || command === '/jarvisbriefgood') {
    return await handleJarvisBriefFeedback('good', message);
  }
  if (command === '/jarvis_brief_bad' || command === '/jarvisbriefbad') {
    return await handleJarvisBriefFeedback('bad', message);
  }
  if (command === '/jarvis_priority_feedback' || command === '/jarvispriorityfeedback') {
    const args = text.substring(command.length).trim();
    return await handleJarvisPriorityFeedback(args, message);
  }
  if (command === '/jarvis_ignore_priority' || command === '/jarvisignorepriority') {
    const args = text.substring(command.length).trim();
    return await handleJarvisIgnorePriority(args, message);
  }
  if (command === '/jarvis_pin_priority' || command === '/jarvispinpriority') {
    const args = text.substring(command.length).trim();
    return await handleJarvisPinPriority(args, message);
  }
  if (command === '/jarvis_action_preview' || command === '/jarvisactionpreview') {
    const priorityId = text.substring(command.length).trim();
    return await handleJarvisActionPreview(priorityId, message);
  }
  if (command === '/jarvis_propose_action' || command === '/jarvisproposeaction') {
    const priorityId = text.substring(command.length).trim();
    return await handleJarvisProposeAction(priorityId, message);
  }
  if (command === '/jarvis_approvals' || command === '/jarvisapprovals') {
    return await handleJarvisApprovals(message);
  }
  if (command === '/jarvis_approval' || command === '/jarvisapproval') {
    const approvalId = text.substring(command.length).trim();
    return await handleJarvisApprovalDetails(approvalId, message);
  }
  if (command === '/jarvis_approve' || command === '/jarvisapprove') {
    const approvalId = text.substring(command.length).trim();
    return await handleJarvisApprove(approvalId, message);
  }
  if (command === '/jarvis_reject' || command === '/jarvisreject') {
    const approvalId = text.substring(command.length).trim();
    return await handleJarvisReject(approvalId, message);
  }
  if (command === '/jarvis_cancel_approval' || command === '/jarviscancelapproval') {
    const approvalId = text.substring(command.length).trim();
    return await handleJarvisCancelApproval(approvalId, message);
  }
  if (command === '/jarvis_approval_history' || command === '/jarvisapprovalhistory') {
    const args = text.substring(command.length).trim();
    return await handleJarvisApprovalHistory(args, message);
  }
  if (command === '/jarvis_approval_stats' || command === '/jarvisapprovalstats') {
    return await handleJarvisApprovalStats(message);
  }
  if (command === '/chatid' || command === '/id') {
    const userId = message.from?.id || 'unknown';
    const chatId = message.chat?.id || 'unknown';
    return `🆔 *Telegram Identity Info*\n\n• *User ID:* \`${userId}\`\n• *Chat ID:* \`${chatId}\``;
  }
  if (command === '/bots') return handleBots();
  if (command === '/registry') return handleRegistry();
  if (command === '/inbox') return await handleInbox();
  if (command === '/inbox_latest' || command === '/inboxlatest') return await handleInboxLatest();
  if (command === '/inbox_read' || command === '/inboxread') {
    const filename = text.trim().split(/\s+/)[1];
    return await handleInboxRead(filename);
  }
  if (command === '/drive_latest' || command === '/drivelatest') return await handleDriveLatest(message);
  if (command === '/drive_publish_latest' || command === '/drivepublishlatest') return await handleDrivePublishLatest(message);
  if (command === '/drive_publish_pending' || command === '/drivepublishpending') return await handleDrivePublishPending(message);
  if (command === '/drive_republish_latest' || command === '/driverepublishlatest') return await handleDriveRepublishLatest(message);
  if (command === '/drive_publish_file' || command === '/drivepublishfile') {
    const filename = text.trim().split(/\s+/)[1];
    return await handleDrivePublishFile(filename, message);
  }
  if (command === '/drive_publish_campaign' || command === '/drivepublishcampaign') {
    const campaignName = text.trim().split(/\s+/)[1];
    return await handleDrivePublishCampaign(campaignName, message);
  }
  if (command === '/run_bot' || command === '/run' || command === '/runtime_run') {
    return await handleRunBot(text, message);
  }
  if (command === '/run_publish' || command === '/rp' || command === '/run_bot_publish') {
    return await handleRunPublish(text, message);
  }
  if (command === '/run_status' || command === '/runstatus') {
    return await handleRunStatus(message);
  }
  if (command === '/run_latest' || command === '/runlatest') {
    return await handleRunLatest(message);
  }
  if (command === '/run_history' || command === '/runhistory') {
    return await handleRunHistory(message);
  }
  if (command === '/run_metrics' || command === '/runmetrics') {
    return await handleRunMetrics(message);
  }
  if (command === '/run_errors' || command === '/runerrors') {
    return await handleRunErrors(message);
  }
  if (command === '/run_config' || command === '/runconfig') {
    return await handleRunConfig(message);
  }
  if (command === '/run_job' || command === '/runjob') {
    const jobId = text.trim().split(/\s+/)[1];
    return await handleRunJob(jobId, message);
  }
  if (command === '/run_search' || command === '/runsearch') {
    const keyword = text.trim().substring(command.length).trim();
    return await handleRunSearch(keyword, message);
  }
  if (command === '/run_by_bot' || command === '/runbybot') {
    const botSlug = text.trim().split(/\s+/)[1];
    return await handleRunByBot(botSlug, message);
  }
  if (command === '/run_reindex' || command === '/runreindex') {
    return await handleRunReindex(message);
  }
  if (command === '/run_permissions' || command === '/runpermissions') {
    return await handleRunPermissions(message);
  }
  if (command === '/run_roles' || command === '/runroles') {
    return await handleRunRoles(message);
  }
  if (command === '/my_role' || command === '/myrole') {
    return await handleMyRole(message);
  }
  if (command === '/connector_list' || command === '/connectorlist') {
    return await handleConnectorList(message);
  }
  if (command === '/connector_info' || command === '/connectorinfo') {
    const connectorId = text.trim().split(/\s+/)[1];
    return await handleConnectorInfo(connectorId, message);
  }
  if (command === '/connector_validate' || command === '/connectorvalidate') {
    const connectorId = text.trim().split(/\s+/)[1];
    return await handleConnectorValidate(connectorId, message);
  }
  if (command === '/preset_list' || command === '/presetlist') {
    return await handlePresetList(message);
  }
  if (command === '/preset_info' || command === '/presetinfo') {
    const presetId = text.trim().split(/\s+/)[1];
    return await handlePresetInfo(presetId, message);
  }
  if (command === '/run_preset' || command === '/runpreset') {
    return await handleRunPreset(text, message);
  }
  if (command === '/run_preset_publish' || command === '/runpresetpublish') {
    return await handleRunPresetPublish(text, message);
  }
  if (command === '/approval_list' || command === '/approvallist') {
    return await handleApprovalList(message);
  }
  if (command === '/approval_info' || command === '/approvalinfo') {
    const approvalId = text.trim().split(/\s+/)[1];
    return await handleApprovalInfo(approvalId, message);
  }
  if (command === '/approve_run' || command === '/approverun') {
    const approvalId = text.trim().split(/\s+/)[1];
    return await handleApproveRun(approvalId, message);
  }
  if (command === '/reject_run' || command === '/rejectrun') {
    const approvalId = text.trim().split(/\s+/)[1];
    return await handleRejectRun(approvalId, message);
  }
  if (command === '/approval_history' || command === '/approvalhistory') {
    return await handleApprovalHistory(message);
  }
  if (command === '/approval_search' || command === '/approvalsearch') {
    const keyword = text.trim().substring(command.length).trim();
    return await handleApprovalSearch(keyword, message);
  }
  if (command === '/approval_by_status' || command === '/approvalbystatus') {
    const status = text.trim().split(/\s+/)[1];
    return await handleApprovalByStatus(status, message);
  }
  if (command === '/approval_cleanup_expired' || command === '/approvalcleanupexpired') {
    return await handleApprovalCleanupExpired(message);
  }
  if (command === '/dryrun_action' || command === '/dryrunaction') {
    return await handleDryRunAction(text, message);
  }
  if (command === '/dryrun_publish' || command === '/dryrunpublish') {
    return await handleDryRunPublish(text, message);
  }
  if (command === '/dryrun_info' || command === '/dryruninfo') {
    const dryrunId = text.trim().split(/\s+/)[1];
    return await handleDryRunInfo(dryrunId, message);
  }
  if (command === '/dryrun_history' || command === '/dryrunhistory') {
    return await handleDryRunHistory(message);
  }
  if (command === '/dryrun_types' || command === '/dryruntypes') {
    return await handleDryRunTypes(message);
  }

  // Hermes Core Queue Commands
  if (command === '/hermes_status' || command === '/hermesstatus') {
    return await handleHermesStatus(message);
  }
  if (command === '/hermes_queue' || command === '/hermesqueue') {
    const filterArg = text.trim().split(/\s+/)[1];
    return await handleHermesQueue(filterArg, message);
  }
  if (command === '/hermes_latest' || command === '/hermeslatest') {
    return await handleHermesLatest(message);
  }
  if (command === '/hermes_read' || command === '/hermesread') {
    const jobId = text.trim().split(/\s+/)[1];
    return await handleHermesRead(jobId, message);
  }
  if (command === '/hermes_cancel' || command === '/hermescancel') {
    const tokens = text.trim().split(/\s+/);
    const jobId = tokens[1];
    const reason = tokens.slice(2).join(' ');
    return await handleHermesCancel(jobId, reason, message);
  }
  if (command === '/hermes_retry' || command === '/hermesretry') {
    const jobId = text.trim().split(/\s+/)[1];
    return await handleHermesRetry(jobId, message);
  }
  if (command === '/hermes_dispatch' || command === '/hermesdispatch') {
    const jobId = text.trim().split(/\s+/)[1];
    return await handleHermesDispatch(jobId, message);
  }
  if (command === '/hermes_approval' || command === '/hermesapproval') {
    return await handleHermesApproval(message);
  }
  if (command === '/hermes_approve' || command === '/hermesapprove') {
    const approvalId = text.trim().split(/\s+/)[1];
    return await handleHermesApprove(approvalId, message);
  }
  if (command === '/hermes_search' || command === '/hermessearch') {
    const query = text.trim().substring(command.length).trim();
    return await handleHermesSearch(query, message);
  }
  if (command === '/hermes_trace' || command === '/hermestrace') {
    const jobId = text.trim().split(/\s+/)[1];
    return await handleHermesTrace(jobId, message);
  }
  if (command === '/hermes_failures' || command === '/hermesfailures') {
    return await handleHermesFailures(message);
  }
  if (command === '/hermes_health' || command === '/hermeshealth') {
    return await handleHermesHealth(message);
  }

  // Prospect Operator Commands
  if (command === '/prospect_status' || command === '/prospectstatus') {
    return await handleProspectStatus(message);
  }
  if (command === '/prospect_search' || command === '/prospectsearch') {
    const query = text.substring(command.length).trim();
    return await handleProspectSearch(query, message);
  }
  if (command === '/prospect_latest' || command === '/prospectlatest') {
    return await handleProspectLatest(message);
  }
  if (command === '/prospect_list' || command === '/prospectlist') {
    return await handleProspectList(message);
  }
  if (command === '/prospect_read' || command === '/prospectread') {
    const prospectId = text.substring(command.length).trim();
    return await handleProspectRead(prospectId, message);
  }
  if (command === '/prospect_outreach' || command === '/prospectoutreach') {
    const prospectId = text.substring(command.length).trim();
    return await handleProspectOutreach(prospectId, message);
  }
  if (command === '/prospect_outreach_batch' || command === '/prospectoutreachbatch') {
    const args = text.substring(command.length).trim();
    return await handleProspectOutreachBatch(args, message);
  }
  if (command === '/outreach_status' || command === '/outreachstatus') {
    return await handleOutreachStatus(message);
  }
  if (command === '/outreach_list' || command === '/outreachlist') {
    return await handleOutreachList(message);
  }
  if (command === '/outreach_read' || command === '/outreachread') {
    const idOrPid = text.substring(command.length).trim();
    return await handleOutreachRead(idOrPid, message);
  }
  if (command === '/outreach_mark' || command === '/outreachmark') {
    const args = text.substring(command.length).trim();
    return await handleOutreachMark(args, message);
  }
  if (command === '/outreach_note' || command === '/outreachnote') {
    const args = text.substring(command.length).trim();
    return await handleOutreachNote(args, message);
  }
  if (command === '/outreach_today' || command === '/outreachtoday') {
    return await handleOutreachToday(message);
  }
  if (command === '/outreach_due' || command === '/outreachdue') {
    return await handleOutreachDue(message);
  }
  if (command === '/outreach_pipeline' || command === '/outreachpipeline') {
    return await handleOutreachPipeline(message);
  }
  if (command === '/outreach_mark_contacted' || command === '/outreachmarkcontacted') {
    const args = text.substring(command.length).trim();
    return await handleOutreachMarkContacted(args, message);
  }
  if (command === '/outreach_followup' || command === '/outreachfollowup') {
    const args = text.substring(command.length).trim();
    return await handleOutreachFollowUp(args, message);
  }
  if (command === '/research_prospect' || command === '/researchprospect') {
    const prospectId = text.substring(command.length).trim();
    return await handleResearchProspect(prospectId, message);
  }
  if (command === '/research_read' || command === '/researchread') {
    const args = text.substring(command.length).trim();
    return await handleResearchRead(args, message);
  }
  if (command === '/research_latest' || command === '/researchlatest') {
    return await handleResearchLatest(message);
  }
  if (command === '/research_status' || command === '/researchstatus') {
    return await handleResearchStatus(message);
  }
  if (command === '/score_prospect' || command === '/scoreprospect') {
    const prospectId = text.substring(command.length).trim();
    return await handleScoreProspect(prospectId, message);
  }
  if (command === '/score_read' || command === '/scoreread') {
    const args = text.substring(command.length).trim();
    return await handleScoreRead(args, message);
  }
  if (command === '/score_latest' || command === '/scorelatest') {
    return await handleScoreLatest(message);
  }
  if (command === '/score_top' || command === '/scoretop') {
    return await handleScoreTop(message);
  }
  if (command === '/cockpit_today' || command === '/cockpittoday') {
    return await handleCockpitToday(message);
  }
  if (command === '/cockpit_top' || command === '/cockpittop') {
    return await handleCockpitTop(message);
  }
  if (command === '/cockpit_due' || command === '/cockpitdue') {
    return await handleCockpitDue(message);
  }
  if (command === '/cockpit_next' || command === '/cockpitnext') {
    return await handleCockpitNext(message);
  }

  // 2. OpenClaw Bot Routing
  if (command === '/content_forge' || command === '/contentforge' || command === '/cf') {
    return await handleOpenClawBot('content-forge', parsed.workflow, parsed.fields, message);
  }
  if (command === '/revenue' || command === '/revenue_master' || command === '/rmo') {
    return await handleOpenClawBot('revenue-master-orchestrator', parsed.workflow, parsed.fields, message);
  }
  if (command === '/sys' || command === '/system_master' || command === '/smo') {
    return await handleOpenClawBot('system-master-orchestrator', parsed.workflow, parsed.fields, message);
  }
  if (command === '/aeo' || command === '/cresca_content' || command === '/cresca') {
    return await handleOpenClawBot('cresca-content-aeo-engine', parsed.workflow, parsed.fields, message);
  }
  if (command === '/leads' || command === '/lead_acquisition' || command === '/lae') {
    return await handleOpenClawBot('lead-acquisition-engine', parsed.workflow, parsed.fields, message);
  }
  if (command === '/rev_opt' || command === '/revenue_optimization' || command === '/roe') {
    return await handleOpenClawBot('revenue-optimization-engine', parsed.workflow, parsed.fields, message);
  }
  if (command === '/weekly' || command === '/command_center' || command === '/wcc') {
    return await handleOpenClawBot('weekly-command-center', parsed.workflow, parsed.fields, message);
  }
  if (command === '/client_value' || command === '/value_maximizer' || command === '/cvm') {
    return await handleOpenClawBot('client-value-maximizer', parsed.workflow, parsed.fields, message);
  }
  if (command === '/autoloop' || command === '/auto_loop' || command === '/als') {
    return await handleOpenClawBot('auto-loop-system', parsed.workflow, parsed.fields, message);
  }

  // 3. Legacy Admin Commands
  const legacyArgs = text.split(' ').slice(1);
  const legacyHandler = LEGACY_COMMANDS[command];
  if (legacyHandler) {
    return await legacyHandler(legacyArgs, 'system');
  }

  return `Unknown command: ${command}\nType /help for available commands.`;
}

function handleHelp() {
  return `OpenClaw Telegram Router\n\nAvailable Commands:\n/help - Show this message\n/menu - Show main operator dashboard menu\n/bots - List known bots\n/registry - Registry summary\n/inbox - List 5 most recent queued requests\n/inbox_latest - Show the latest request summary\n/inbox_read <filename> - Read a specific request\n/run_bot <bot_slug> <user_request> - Run approved bot workflow at runtime (also /run, /runtime_run)
/run_publish <bot_slug> <user_request> - Run bot AND publish result to Google Drive atomically (also /rp, /run_bot_publish)
/run_status - Inspect runtime health and config
/run_latest - Inspect details of the latest result
/run_history - View recent execution history
/run_metrics - View execution and publishing metrics (also /runmetrics)
/run_errors - View recent sanitized runtime error logs (also /runerrors)
/run_config - View safe runtime configuration (also /runconfig)
/run_job <job_id> - Inspect one runtime job by ID (also /runjob)
/run_search <keyword> - Search runtime jobs by keyword (also /runsearch)
/run_by_bot <bot_slug> - View recent jobs for a specific approved bot (also /runbybot)
/run_reindex - Rebuild the job index from logs and results (also /runreindex)
/run_permissions - Shows runtime command permissions (also /runpermissions)
/run_roles - Shows safe role system summary (also /runroles)
/my_role - Shows the current user's effective role and capabilities (also /myrole)
/preset_list - Show all available presets (also /presetlist)
/preset_info <preset_id> - View detailed preset configuration (also /presetinfo)
/run_preset <preset_id> <input> - Run preset using configured bot and template (also /runpreset)
/run_preset_publish <preset_id> <input> - Run preset and publish generated file atomically (also /runpresetpublish)
/approval_list - Show pending approvals (also /approvallist)
/approval_info <approval_id> - Show details of one pending approval (also /approvalinfo)
/approve_run <approval_id> - Approve and execute pending run (also /approverun)
/reject_run <approval_id> - Reject pending run (also /rejectrun)
/approval_history - Shows recent approval activity (also /approvalhistory)
/approval_search <keyword> - Searches approval records by keyword (also /approvalsearch)
/approval_by_status <status> - Lists approvals by status (also /approvalbystatus)
/approval_cleanup_expired - Admin-only maintenance command to clean up expired pending approvals (also /approvalcleanupexpired)
/dry_run_types - List supported dry-run action types (also /dryruntypes)
/dryrun_action <type> <req> - Create dry-run preview (also /dryrunaction)
/dryrun_publish <type> <req> - Request gated dry-run publish (also /dryrunpublish)
/dryrun_info <dryrun_id> - Show dry-run details (also /dryruninfo)
/dryrun_history - Show recent dry-run history (also /dryrunhistory)
/connector_list - List external action connectors (also /connectorlist)
/connector_info <id> - Show connector metadata (also /connectorinfo)
/connector_validate <id> - Check environment variables for a connector (also /connectorvalidate)
/jarvis_process_latest <project_slug> - Assign latest unprocessed upload and mark processed (also /jarvisprocesslatest)
/jarvis_archive_processed - Archive all processed uploads (also /jarvisarchiveprocessed)
/jarvis_folders - List registered local folders (also /jarvisfolders)
/jarvis_add_folder <path> - Register a local folder (pending approval) (also /jarvisaddfolder)
/jarvis_approve_folder <id_or_path> - Approve a registered folder path (also /jarvisapprovefolder)
/jarvis_scan - Scan approved folders and index file metadata (also /jarvisscan)
/jarvis_files [project_slug] - List indexed local files and mapping suggestions (also /jarvisfiles)
/jarvis_connectors - List registered cloud connectors and status (also /jarvisconnectors)
/jarvis_email_summary - Show unread important email summaries (also /jarvisemailsummary)
/jarvis_drive_recent - Show recently modified Google Drive files (also /jarvisdriverecent)
/prospect_status - Show prospect API configuration and status (also /prospectstatus)
/prospect_search <query> - Search and catalog prospects locally (also /prospectsearch)
/prospect_latest - Show the latest saved prospects (also /prospectlatest)
/prospect_list - Show recent saved prospects (also /prospectlist)
/prospect_read <prospectId> - Show safe details for a specific prospect (also /prospectread)
/prospect_outreach <prospectId> - Handoff prospect to Hermes outreach generation queue (also /prospectoutreach)
/prospect_outreach_batch <id1,id2,...> - Handoff multiple prospects to Hermes queue in batch (also /prospectoutreachbatch)
/outreach_status - Show manual outreach review status counts (also /outreachstatus)
/outreach_list - Show recent manual outreach review records (also /outreachlist)
/outreach_read <reviewId or prospectId> - Show detailed manual outreach drafts (also /outreachread)
/outreach_mark <reviewId> <status> - Update manual status for a specific outreach review (also /outreachmark)
/outreach_note <reviewId> <note> - Update operator notes for a specific outreach review (also /outreachnote)
/outreach_today - List reviews where manual follow-up is due today/overdue (also /outreachtoday)
/outreach_due - List all manual reviews with follow-up scheduled (also /outreachdue)
/outreach_pipeline - Show manual outreach pipeline counts summary (also /outreachpipeline)
/outreach_mark_contacted <reviewId> <channel> - Log manual contact and increment count (also /outreachmarkcontacted)
/outreach_followup <reviewId> <YYYY-MM-DD> - Log follow-up schedule and set status (also /outreachfollowup)
/research_prospect <prospectId> - Enrich prospect details with website context (also /researchprospect)
/research_read <researchId or prospectId> - Show detailed research findings for a prospect (also /researchread)
/research_latest - Show the 5 most recently created research records (also /researchlatest)
/research_status - Show research adapter registry status (also /researchstatus)
/score_prospect <prospectId> - Offline prospect fit and channel evaluation (also /scoreprospect)
/score_read <scoreId or prospectId> - Show detailed scoring for a prospect (also /scoreread)
/score_latest - Show the 5 most recently created score records (also /scorelatest)
/score_top - Show top 5 score records sorted by fitScore descending (also /scoretop)
/cockpit_today - Show daily cockpit summary, top prospects, and follow-ups (also /cockpittoday)
/cockpit_top - List top 10 ranked prospects in the cockpit (also /cockpittop)
/cockpit_due - List prospects with follow-ups scheduled for today or overdue (also /cockpitdue)
/cockpit_next - List next 5 high-priority prospects to contact (not contacted yet) (also /cockpitnext)
` +
`\nGoogle Drive Commands:\n/drive_latest - Show the latest published file info\n/drive_publish_latest - Publish the latest output (skips if already published)\n/drive_publish_pending - Publish the latest UNPUBLISHED output file only\n/drive_republish_latest - Force re-upload of the latest output file\n/drive_publish_file <filename> - Publish a specific result file\n/drive_publish_campaign <campaign> - Publish a campaign folder\n\nRecommended workflows:\n  Manual:\n  1. /run_bot revenue-master-orchestrator <user_request>\n  2. /drive_publish_pending\n  3. /drive_latest\n\n  Controlled (single command):\n  /run_publish content-forge <user_request>\n  /drive_latest\n\nBot Commands & Examples:\n1. Creative (Content Forge):\n   /cf image_prompts\n   Project: SeptiVolt\n   Campaign: Batch 001\n   Runtime Execution:\n   /run_bot content-forge Create 5 TikTok ad scripts for Cresca OS targeting cleaning business owners\n   Controlled Run+Publish:\n   /run_publish content-forge Create 5 TikTok ad scripts for Cresca OS targeting cleaning business owners\n2. Business (Revenue Master):\n   /revenue system_design\n   Business Name: SeptiVolt\n   Business Type: SaaS\n   Runtime Execution:\n   /run_bot revenue-master-orchestrator Create a GHL system plan for SeptiVolt\n   Controlled Run+Publish:\n   /run_publish revenue-master-orchestrator Create a GHL system plan for SeptiVolt\n3. Tech (System Master):\n   /sys build_app\n   App Name: septivolt-portal\n   Framework: Next.js\n4. Copywriting (Cresca Content/AEO):\n   /aeo optimize_page\n   Page URL: https://septivolt.com\n5. Leads (Lead Acquisition):
   /leads prospect
   Target Location: Nassau County
   Platform Focus: Google Ads
   Runtime Execution:
   /run_bot lead-acquisition-engine Create a lead acquisition plan for cleaning companies in Suffolk County
   Controlled Run+Publish:
   /run_publish lead-acquisition-engine Create a local prospecting plan for solar installers in Florida\n6. Funnel Audit (Revenue Optimization):\n   /rev_opt audit\n   Funnel Link: https://ggcleaningli.com/quote\n7. Ops (Weekly Command):\n   /weekly review\n   Week Range: May 18 - May 24\n8. Monetize (Client Value):\n   /client_value upsell\n   Brand Name: Cresca OS\n9. Optimization Loop (Auto-Loop):\n   /autoloop review\n   System Being Audited: ad funnel`;
}
function getSuggestedFollowUp(botSlug, workflow) {
  const b = botSlug.toLowerCase();
  const w = workflow.toLowerCase().replace(/_/g, '-');

  if (b === 'content-forge') {
    if (w === 'image-prompts') return '/cf video_prompt';
    if (w === 'video-prompt') return '/cf qa_video';
    if (w === 'qa-video') return '/cf copy_pack';
    if (w === 'copy-pack') return '/cf repurpose';
    if (w === 'repurpose') return '/cf finalize_campaign';
    return '/drive_publish_latest';
  }

  if (b === 'revenue-master-orchestrator') {
    if (w === 'system-design') return '/revenue offer_design';
    if (w === 'offer-design') return '/revenue ghl_setup';
    return '/drive_publish_latest';
  }

  if (b === 'system-master-orchestrator') {
    if (w === 'build-app') return '/sys deploy';
    if (w === 'deploy') return '/sys fix_bug';
    return '/drive_publish_latest';
  }

  if (b === 'cresca-content-aeo-engine') {
    if (w === 'optimize-page') return '/aeo faq_schema';
    return '/drive_publish_latest';
  }

  if (b === 'lead-acquisition-engine') {
    if (w === 'icp-define') return '/leads prospect';
    if (w === 'prospect') return '/leads scripts';
    return '/drive_publish_latest';
  }

  if (b === 'revenue-optimization-engine') {
    if (w === 'audit') return '/rev_opt speed_lead';
    return '/drive_publish_latest';
  }

  if (b === 'weekly-command-center') {
    if (w === 'review') return '/weekly plan';
    return '/drive_publish_latest';
  }

  if (b === 'client-value-maximizer') {
    if (w === 'upsell') return '/client_value reactivate';
    if (w === 'reactivate') return '/client_value referral';
    return '/drive_publish_latest';
  }

  if (b === 'auto-loop-system') {
    if (w === 'setup') return '/autoloop review';
    return '/drive_publish_latest';
  }

  return '/drive_publish_latest';
}

function handleBots() {
  const registry = parseRegistry();
  const activeRuntime = registry.active_runtime.map(b => `- ${b.name}`).join('\n') || '- None';
  const activeQueueOnly = registry.active_queue_only.map(b => `- ${b.name}`).join('\n') || '- None';
  const documented = registry.documented.map(b => `- ${b.name}`).join('\n') || '- None';
  return `🤖 OpenClaw Bot Registry\n\nActive Runtime:\n${activeRuntime}\n\nActive Queue-Only:\n${activeQueueOnly}\n\nDocumented Only:\n${documented}`;
}

function handleRegistry() {
  const registry = parseRegistry();
  return `OpenClaw Bot Registry Summary\nTotal Active Runtime: ${registry.active_runtime.length}\nTotal Active Queue-Only: ${registry.active_queue_only.length}\nTotal Documented: ${registry.documented.length}\nType /bots for full list.`;
}

async function handleOpenClawBot(botSlug, workflow, fields, message) {
  const status = checkBotStatus(botSlug);

  if (status === 'documented') {
    let botName = botSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return `${botName} is registered as Documented Only and has not been activated yet.\n\nRecommended next action:\nImplement ${botName} before running these commands.`;
  }
  
  if (status === 'unknown') {
    return `Bot '${botSlug}' is not found in the OpenClaw registry.\nType /bots to see available bots.`;
  }

  // Active Runtime or Active Queue-Only
  const payload = await saveToInbox(botSlug, workflow, fields, message);
  
  const botName = botSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  
  if (status === 'active_queue_only') {
    const nextManualStep = payload.next_manual_step ? (payload.next_manual_step.trim() + " ") : "";
    const followUp = getSuggestedFollowUp(botSlug, workflow);
    return `Request queued for ${botName}.\n\n` +
           `Bot: ${botSlug}\n` +
           `Workflow: ${workflow}\n` +
           `Status: queued\n\n` +
           `Next step:\n` +
           `${nextManualStep}Process this latest inbox request with Antigravity, then publish the result to Google Drive.\n\n` +
           `Suggested follow-up command after processing: ${followUp}`;
  }

  // Active Runtime fallback
  let reply = `${botSlug.replace('-', ' ').toUpperCase()} request received.\n\nBot: ${botSlug}\nWorkflow: ${workflow}\nStatus: Saved to OpenClaw inbox`;
  if (payload.next_manual_step) {
    reply += `\n\nNext step:\nReview the queued request in openclaw/inbox/telegram-requests/.\n\n${payload.next_manual_step}`;
  } else {
    reply += `\n\nRequest saved to OpenClaw inbox. Runtime execution is not connected yet.`;
  }
  return reply;
}

// ------------------------------------------
// Legacy System Handlers
// ------------------------------------------

const LEGACY_COMMANDS = {
  '/status': handleStatus,
  '/tenant': handleTenantStatus,
  '/queues': handleQueues,
  '/health': handleHealth,
  '/incidents': handleIncidents,
  '/pause-queue': handlePauseQueue,
  '/resume-queue': handleResumeQueue,
  '/safe-mode': handleSafeMode,
  '/replay': handleReplay
};

async function handleStatus() {
  if (!supabase) return "⚠️ Supabase offline. Cannot fetch live status.";
  const { data: metrics, error } = await supabase.from('sync_metrics').select('metric_name, value').limit(100);
  if (error || !metrics || metrics.length === 0) return "📊 Status: No live data available yet.";
  const success = metrics.filter(m => m.metric_name === 'sync_success').length;
  const failure = metrics.filter(m => m.metric_name === 'sync_failure').length;
  const health = success > 0 ? Math.round((success / (success + failure)) * 100) : 0;
  return `🚀 Cresca OS Runtime: ACTIVE\nHealth Score: ${health}/100\nTotal Success: ${success}\nTotal Failures: ${failure}\nProviders: GHL (Healthy)`;
}

async function handleTenantStatus(args) {
  const tenantId = args[0];
  if (!tenantId) return "Usage: /tenant TENANT_ID";
  if (!supabase) return "⚠️ Supabase offline.";
  const { data: metrics, error } = await supabase.from('sync_metrics').select('metric_name').eq('tenant_id', tenantId);
  if (error || !metrics || metrics.length === 0) return `📊 Status for ${tenantId}: No live data available yet.`;
  const success = metrics.filter(m => m.metric_name === 'sync_success').length;
  const errors = metrics.filter(m => m.metric_name === 'sync_failure').length;
  return `📊 Status for Tenant ${tenantId}:\nSyncs: ${success}\nErrors: ${errors}\nHealth: ${errors === 0 ? 'Stable' : 'Degraded'}`;
}

async function handleQueues() {
  if (!supabase) return "⚠️ Supabase offline.";
  const { count: dlqCount } = await supabase.from('dead_letter_events').select('*', { count: 'exact', head: true });
  return `📥 Queue Status:\nMain: 0 pending (async)\nRetries: 0 pending\nDead Letter: ${dlqCount || 0} total`;
}

async function handleHealth() {
  const ghlStatus = circuitBreakerRegistry.getStatus({ provider: 'ghl', tenantId: 'any' });
  return `🩺 System Health:\n- DB: ${supabase ? 'Connected' : 'Offline'}\n- GHL API: ${ghlStatus.global.state.toUpperCase()}\n- Safe Mode: ${runtimeGovernor.isSafeMode() ? 'ACTIVE' : 'INACTIVE'}`;
}

async function handleIncidents() {
  if (!supabase) return "⚠️ Supabase offline.";
  const { data: incidents, error } = await supabase.from('incident_history').select('*').eq('status', 'open').limit(5);
  if (error || !incidents || incidents.length === 0) return "🚨 No active incidents detected.";
  const list = incidents.map(i => `- ${i.provider}:${i.metadata.error_class || 'Unknown'} (${i.severity})`).join('\n');
  return `🚨 Active Incidents:\n${list}`;
}

async function handlePauseQueue() {
  await runtimeGovernor.enterSafeMode('Manual pause via Telegram', true);
  return "🛑 Queues PAUSED. System entering Safe Mode.";
}

async function handleResumeQueue() {
  await runtimeGovernor.exitSafeMode(true);
  return "✅ Queues RESUMED. System exiting Safe Mode.";
}

async function handleSafeMode() {
  return `🛡️ Safe Mode Status: ${runtimeGovernor.isSafeMode() ? 'ACTIVE' : 'INACTIVE'}\nReason: ${runtimeGovernor.reason || 'None'}`;
}

async function handleReplay(args) {
  const eventId = args[0];
  const confirmFlag = args[1];
  if (!eventId || confirmFlag !== '--confirm') {
    return "Usage: /replay EVENT_ID --confirm [REASON]";
  }
  const reason = args.slice(2).join(' ') || 'Manual replay via Telegram';
  try {
    await replayEvent(eventId, reason);
    return `🔄 Replay initiated for event ${eventId}. Replay will respect runtime governance.`;
  } catch (err) {
    return `❌ Replay failed: ${err.message}`;
  }
}

async function handleRunBot(text, message) {
  const { generateRuntimeJobId } = require('../../openclaw/runtime/runtime-job-id');
  const jobId = generateRuntimeJobId();
  
  const trimmed = text.trim();
  const commandWord = trimmed.split(/\s+/)[0];
  const commandTextWithoutCmd = trimmed.substring(commandWord.length).trim();

  // Find bot slug (the first word of the rest of the text)
  const firstSpaceIdx = commandTextWithoutCmd.search(/\s/);
  let botSlug = '';
  let userRequest = '';
  if (firstSpaceIdx === -1) {
    botSlug = commandTextWithoutCmd;
    userRequest = '';
  } else {
    botSlug = commandTextWithoutCmd.substring(0, firstSpaceIdx).trim();
    userRequest = commandTextWithoutCmd.substring(firstSpaceIdx).trim();
  }

  const senderChatId = message.chat?.id || '';

  const result = await runtimeExecutor.runBot(botSlug, userRequest, senderChatId, jobId);
  return result.message;
}

/**
 * /run_publish <bot_slug> <user_request>
 * Admin-only. Atomically runs an approved bot and publishes the EXACT generated
 * file to Google Drive in a single controlled flow.
 * Aliases: /rp, /run_bot_publish
 */
async function handleRunPublish(text, message, approvalId = null) {
  // 1. Authorization check — admin only, before any execution
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/run_publish', message);
  if (!permCheck.allowed) {
    const { generateRuntimeJobId } = require('../../openclaw/runtime/runtime-job-id');
    const jobId = generateRuntimeJobId();
    try {
      const runtimeLogger = require('../../openclaw/runtime/runtime-logger');
      runtimeLogger.logEvent({
        jobId,
        type: 'runtime_execution',
        command: 'run_publish',
        botSlug: null,
        status: 'failure',
        errorCategory: 'unauthorized',
        safeMessage: 'Access Denied: You are not authorized to execute run_publish.'
      });
    } catch (logErr) {}
    return formatPermissionDenied('/run_publish', permCheck.reason, message);
  }

  // 2. Parse bot slug and user request
  const trimmed = text.trim();
  const commandWord = trimmed.split(/\s+/)[0];
  const commandTextWithoutCmd = trimmed.substring(commandWord.length).trim();

  const firstSpaceIdx = commandTextWithoutCmd.search(/\s/);
  let botSlug = '';
  let userRequest = '';
  if (firstSpaceIdx === -1) {
    botSlug = commandTextWithoutCmd;
    userRequest = '';
  } else {
    botSlug = commandTextWithoutCmd.substring(0, firstSpaceIdx).trim();
    userRequest = commandTextWithoutCmd.substring(firstSpaceIdx).trim();
  }

  // 3. Reject missing bot slug
  if (!botSlug) {
    return [
      '❌ Missing bot slug.',
      '',
      'Usage: /run_publish <bot_slug> <user_request>',
      'Example: /run_publish content-forge Create 5 TikTok hooks for Cresca OS targeting cleaning business owners'
    ].join('\n');
  }

  // 4. Reject empty request
  if (!userRequest || !userRequest.trim()) {
    return [
      `❌ Missing request details for bot: ${botSlug}`,
      '',
      `Usage: /run_publish ${botSlug} <user_request>`,
      `Example: /run_publish ${botSlug} Create 5 TikTok hooks for Cresca OS targeting cleaning business owners`
    ].join('\n');
  }

  // Check if botSlug is actually allowed before creating approval record
  const { isBotAllowed } = require('../../openclaw/runtime/runtime-allowlist');
  if (!isBotAllowed(botSlug)) {
    return `❌ Rejection: Bot '${botSlug}' is not approved for runtime execution.`;
  }

  // 5. Intercept to create approval
  if (!approvalId && process.env.OPENCLAW_NO_APPROVAL_GATE !== 'true') {
    const { createApproval } = require('../../openclaw/runtime/runtime-approvals');
    const record = createApproval(
      message.chat?.id,
      'run_publish',
      'publish',
      botSlug,
      null,
      userRequest.substring(0, 200),
      { text, message }
    );

    return [
      `Approval Required`,
      `Approval ID: ${record.approvalId}`,
      `Command: run_publish`,
      `Bot: ${record.botSlug}`,
      `Preview: ${record.inputPreview}`,
      `Expires: ${new Date(record.expiresAt).toISOString()}`,
      `To approve:`,
      ` /approve_run ${record.approvalId}`,
      ``,
      `To reject:`,
      ` /reject_run ${record.approvalId}`
    ].join('\n');
  }

  return await executeRunPublish(text, message, approvalId);
}

function isChatAuthorized(message) {
  const senderChatId = message.chat?.id ? String(message.chat.id).trim() : '';
  const runtimeConfig = require('../../openclaw/runtime/runtime-config');
  return runtimeConfig.allowedChatIds.includes(senderChatId);
}

async function handleRunStatus(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/run_status', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/run_status', permCheck.reason, message);
  }

  const runtimeInspector = require('../../openclaw/runtime/runtime-inspector');
  const status = runtimeInspector.getRuntimeStatus();
  
  let msg = "⚙️ *OpenClaw Runtime Status*\n\n";
  msg += "• *Status:* `" + status.status.toUpperCase() + "` (online)\n";
  msg += "• *Active Provider:* `" + status.modelProvider + "`\n";
  msg += "• *Approved Bots:* " + status.approvedBots.join(', ') + "\n";
  msg += "• *Outbox Result Count:* " + status.outboxResultCount + "\n";
  msg += "• *Latest Result File:* `" + status.latestResultFile + "`\n";
  msg += "• *Drive Publish Mode:* `" + status.drivePublishMode + "`\n";
  msg += "• *Presets Enabled:* `" + status.presetsEnabled + "`\n";
  msg += "• *Preset Count:* `" + status.presetCount + "`\n";
  msg += "• *Publish Presets:* `" + status.publishingPresetsEnabled + "`\n";
  msg += "• *Permission Tiers:* `yes`\n";
  msg += "• *Access Model:* `" + status.accessModel + "`\n";
  msg += "• *Role System:* `" + status.roleSystem + "`\n";
  msg += "• *Self-Approval:* `" + status.selfApprovalProtection + "`\n";
  msg += "• *External Actions:* `no`\n";
  msg += "• *Approval Gates:* `" + (status.approvalGatesEnabled ? 'Enabled' : 'Disabled') + "`\n";
  if (status.approvalGatesEnabled) {
    msg += "• *Approval TTL:* `" + status.approvalTtlMinutes + " minutes`\n";
    msg += "• *Gated Tiers:* `" + status.gatedTiers.join(', ') + "`\n";
    msg += "• *Pending Approvals:* `" + status.pendingApprovalsCount + "`\n";
    msg += "• *Approval Audit:* `" + status.approvalAudit + "`\n";
    msg += "• *Approval Search:* `" + status.approvalSearch + "`\n";
    msg += "• *Expired Cleanup:* `" + status.expiredCleanup + "`\n";
  }
  msg += "\n";

  if (status.controlledPublishing && status.controlledPublishing.enabled) {
    const cp = status.controlledPublishing;
    msg += "🚀 *Controlled Publishing:* Enabled\n";
    msg += "• *Command:* `" + cp.command + "`\n";
    msg += "• *Aliases:* " + cp.aliases.map(a => "`" + a + "`").join(', ') + "\n";
    msg += "• *Manual Publishing:* `" + status.manualPublishing + "`\n\n";
  }

  msg += "*Next commands:*\n";
  msg += "• `/run_latest` — Latest result\n";
  msg += "• `/run_history` — Recent history\n";
  msg += "• `/run_publish` <bot> <req> — Run + publish\n";
  msg += "• `/drive_publish_pending` — Publish pending";
  
  return msg;
}

function extractJobIdFromFile(filePath) {
  try {
    const fs = require('fs');
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const match = content.match(/## Job ID\r?\n(rt_[a-zA-Z0-9_]+)/);
      if (match) return match[1];
    }
  } catch (e) {}
  return null;
}

async function handleRunLatest(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/run_latest', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/run_status', permCheck.reason, message);
  }

  const runtimeInspector = require('../../openclaw/runtime/runtime-inspector');
  const latest = runtimeInspector.getLatestRuntimeResult();
  if (!latest) {
    return "ℹ️ *No Runtime Results Found*\n\nNo runtime results exist in `openclaw/outbox/telegram-responses/` yet. Run a bot using `/run_bot`.";
  }

  const path = require('path');
  let workspaceRoot = process.env.OPENCLAW_WORKSPACE_ROOT;
  if (!workspaceRoot || !require('fs').existsSync(path.join(workspaceRoot, 'openclaw'))) {
    workspaceRoot = path.join(__dirname, '../../');
  }
  const filePath = path.join(workspaceRoot, 'openclaw', 'outbox', 'telegram-responses', latest.filename);
  const jobId = extractJobIdFromFile(filePath);

  let msg = "📄 *Latest Runtime Result*\n\n";
  msg += "• *File:* `" + latest.filename + "`\n";
  if (jobId) {
    msg += "• *Job ID:* `" + jobId + "`\n";
  }
  msg += "• *Bot:* `" + latest.botSlug + "`\n";
  msg += "• *Timestamp:* " + latest.timestamp + "\n\n";
  msg += "*Summary:*\n" + latest.summary + "\n\n";
  msg += "*Recommended next command:*\n";
  msg += "• `/drive_publish_pending` — Publish this result to Google Drive";
  if (jobId) {
    msg += "\n• `/run_job " + jobId + "` — Inspect this job execution trace";
  }
  
  return msg;
}

async function handleRunHistory(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/run_history', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/run_status', permCheck.reason, message);
  }

  const runtimeInspector = require('../../openclaw/runtime/runtime-inspector');
  const history = runtimeInspector.getRuntimeHistory(5);
  if (history.length === 0) {
    return "ℹ️ *No Runtime History Found*\n\nNo runtime execution history exists.";
  }

  const path = require('path');
  let workspaceRoot = process.env.OPENCLAW_WORKSPACE_ROOT;
  if (!workspaceRoot || !require('fs').existsSync(path.join(workspaceRoot, 'openclaw'))) {
    workspaceRoot = path.join(__dirname, '../../');
  }

  let msg = "📜 *Recent Runtime History (Last 5)*\n\n";
  history.forEach((item, index) => {
    const filePath = path.join(workspaceRoot, 'openclaw', 'outbox', 'telegram-responses', item.filename);
    const jobId = extractJobIdFromFile(filePath);

    msg += (index + 1) + ". `" + item.filename + "`\n";
    if (jobId) {
      msg += "   • *Job ID:* `" + jobId + "`\n";
    }
    msg += "   • *Bot:* `" + item.botSlug + "` | *Time:* " + item.timestamp + "\n";
    msg += "   • *Drive Status:* `" + item.publishStatus.toUpperCase() + "`\n\n";
  });
  
  msg += "*Recommended next commands:*\n";
  msg += "• `/drive_publish_pending` — Publish any pending files\n";
  msg += "• `/run_latest` — View details of the latest execution";

  return msg;
}

async function handleRunMetrics(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/run_metrics', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/run_metrics', permCheck.reason, message);
  }

  const { getMetrics } = require('../../openclaw/runtime/runtime-metrics');
  const metrics = getMetrics();

  const formatTime = (t) => {
    if (!t) return 'None';
    const datePart = t.substring(0, 10);
    const timePart = t.substring(11, 19);
    return `${datePart} ${timePart}`;
  };

  let msg = "📊 *OpenClaw Runtime Metrics*\n\n";
  msg += "• *Total Executions Tracked:* `" + metrics.totalExecutions + "`\n";
  msg += "• *Successful /run_bot Executions:* `" + metrics.successRunBot + "`\n";
  msg += "• *Failed /run_bot Executions:* `" + metrics.failedRunBot + "`\n";
  msg += "• *Successful /run_publish Executions:* `" + metrics.successRunPublish + "`\n";
  msg += "• *Failed /run_publish Executions:* `" + metrics.failedRunPublish + "`\n";
  if (metrics.successRunPreset !== undefined) {
    msg += "• *Successful /run_preset Executions:* `" + metrics.successRunPreset + "`\n";
    msg += "• *Failed /run_preset Executions:* `" + metrics.failedRunPreset + "`\n";
    msg += "• *Successful /run_preset_publish Executions:* `" + metrics.successRunPresetPublish + "`\n";
    msg += "• *Failed /run_preset_publish Executions:* `" + metrics.failedRunPresetPublish + "`\n";
  }
  msg += "• *Last Successful Run:* " + formatTime(metrics.lastSuccessTime) + "\n";
  msg += "• *Last Failed Run:* " + formatTime(metrics.lastFailedTime) + "\n";
  msg += "• *Most Used Bot:* `" + (metrics.mostUsedBot || 'None') + "`\n";
  msg += "• *Drive Publishing:* `" + metrics.publishSuccess + "` success / `" + metrics.publishFailure + "` failure\n";
  if (metrics.approvalHistoryCount !== undefined) {
    msg += "• *Approval History Count:* `" + metrics.approvalHistoryCount + "`\n";
    msg += "• *Pending Approvals:* `" + metrics.pendingApprovals + "`\n";
    msg += "• *Approved Approvals:* `" + metrics.approvedApprovals + "`\n";
    msg += "• *Rejected Approvals:* `" + metrics.rejectedApprovals + "`\n";
    msg += "• *Expired Approvals:* `" + metrics.expiredApprovals + "`\n";
    msg += "• *Executed Approvals:* `" + metrics.executedApprovals + "`\n";
    msg += "• *Failed Approvals:* `" + metrics.failedApprovals + "`\n";
  } else if (metrics.pendingApprovalsCount !== undefined) {
    msg += "• *Pending Approvals:* `" + metrics.pendingApprovalsCount + "`\n";
    msg += "• *Approved Approvals:* `" + metrics.approvedApprovalsCount + "`\n";
    msg += "• *Rejected Approvals:* `" + metrics.rejectedApprovalsCount + "`\n";
    msg += "• *Expired Approvals:* `" + metrics.expiredApprovalsCount + "`\n";
    msg += "• *Approval Execution Failures:* `" + metrics.approvalExecutionFailureCount + "`\n";
  }
  msg += "\n";
  
  msg += "*Recommended next commands:*\n";
  msg += "• `/run_status` — Inspect runtime health and config\n";
  msg += "• `/run_errors` — View recent sanitized error logs\n";
  msg += "• `/run_history` — View recent execution history";

  return msg;
}

async function handleRunErrors(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/run_errors', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/run_errors', permCheck.reason, message);
  }

  const { getRecentErrors } = require('../../openclaw/runtime/runtime-metrics');
  const errors = getRecentErrors(5);

  if (errors.length === 0) {
    return "ℹ️ *No Runtime Errors Found*\n\nNo recent runtime errors found.";
  }

  const formatTime = (t) => {
    if (!t) return 'Unknown';
    const datePart = t.substring(0, 10);
    const timePart = t.substring(11, 19);
    return `${datePart} ${timePart}`;
  };

  let msg = "🚨 *Recent Runtime Errors (Last 5)*\n\n";
  errors.forEach((err, idx) => {
    msg += (idx + 1) + ". *Time:* `" + formatTime(err.timestamp) + "` | *Cmd:* `" + err.command + "`" + (err.botSlug ? " | *Bot:* `" + err.botSlug + "`" : "") + "\n";
    if (err.jobId) {
      msg += "   • *Job ID:* `" + err.jobId + "`\n";
    }
    msg += "   • *Category:* `" + err.errorCategory + "`\n";
    msg += "   • *Error:* " + err.safeMessage + "\n\n";
  });

  return msg.trim();
}

async function handleRunConfig(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/run_config', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/run_config', permCheck.reason, message);
  }

  const { getSafeConfig } = require('../../openclaw/runtime/runtime-metrics');
  const cfg = getSafeConfig();

  let msg = "⚙️ *OpenClaw Safe Config*\n\n";
  msg += "• *Runtime Status:* `" + cfg.status.toUpperCase() + "`\n";
  msg += "• *Model Provider:* `" + cfg.modelProvider + "`\n";
  msg += "• *Default Model:* `" + cfg.defaultModel + "`\n";
  msg += "• *Approved Bots:* " + cfg.approvedBots.join(', ') + "\n";
  msg += "• *Controlled Publishing:* `" + (cfg.controlledPublishingEnabled ? 'Enabled' : 'Disabled') + "`\n";
  msg += "• *Manual Publishing:* `" + (cfg.manualPublishingEnabled ? 'Enabled' : 'Disabled') + "`\n";
  msg += "• *Outbox Result Count:* `" + cfg.outboxResultCount + "`\n";
  msg += "• *Result Directory:* `" + cfg.runtimeResultDirectoryLabel + "`\n";
  msg += "• *Drive Publishing Mode:* `" + cfg.drivePublishingMode + "`\n";
  msg += "• *Permission Tiers:* `Enabled`\n";
  msg += "• *Access Model:* `" + cfg.accessModel + "`\n";
  msg += "• *Role System:* `" + cfg.roleSystem + "`\n";
  msg += "• *Self-Approval:* `" + cfg.selfApprovalProtection + "`\n";
  msg += "• *External Actions:* `Disabled`\n";
  msg += "• *External Action Dry-Run:* `" + cfg.externalActionDryRun + "`\n";
  msg += "• *Real External Actions:* `" + cfg.realExternalActions + "`\n";
  msg += "• *Supported Dry-Run Action Types:* `" + cfg.supportedDryRunActionTypesCount + "`\n";
  msg += "• *Connector Registry:* `" + cfg.connectorRegistry + "`\n";
  msg += "• *Real External Execution:* `" + cfg.realExternalExecution + "`\n";
  msg += "• *Connectors:* `" + cfg.connectorCount + "`\n";
  msg += "• *Dry-run only:* `" + cfg.connectorsDryRunOnly + "`\n";
  msg += "• *Approval Gates:* `" + cfg.approvalGates + "`\n";
  if (cfg.approvalGates === 'Enabled') {
    msg += "• *Approval TTL:* `" + cfg.approvalTtlMinutes + " minutes`\n";
    msg += "• *Gated Tiers:* `" + cfg.gatedTiers.join(', ') + "`\n";
    msg += "• *Pending Approvals:* `" + cfg.pendingApprovalsCount + "`\n";
    msg += "• *Approval Audit:* `" + cfg.approvalAudit + "`\n";
    msg += "• *Approval Search:* `" + cfg.approvalSearch + "`\n";
    msg += "• *Expired Cleanup:* `" + cfg.expiredCleanup + "`\n";
  }
  msg += "• *Enabled Commands:* " + cfg.enabledCommands.map(c => "`" + c + "`").join(', ') + "\n";

  if (msg.length > 4000) {
    msg = msg.substring(0, 3950) + "\n\n... [Output truncated]";
  }

  return msg;
}

async function handleRunJob(jobId, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/run_job', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/run_job', permCheck.reason, message);
  }

  if (!jobId) {
    return `❌ Usage: /run_job <job_id>\nExample: /run_job rt_20260604_143022_a7f3c9`;
  }

  const { buildJobSummary } = require('../../openclaw/runtime/runtime-job-inspector');
  return buildJobSummary(jobId.trim());
}

async function handleRunSearch(keyword, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/run_search', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/run_search', permCheck.reason, message);
  }

  if (!keyword || !keyword.trim()) {
    return `❌ Usage: /run_search <keyword>\nExample: /run_search cleaning business`;
  }

  const { searchJobs } = require('../../openclaw/runtime/runtime-job-index');
  const results = searchJobs(keyword.trim());
  if (results.length === 0) {
    return "No runtime jobs found matching that search.";
  }

  let msg = `🔍 *Search Results for "${keyword.trim()}" (Max 5)*\n\n`;
  results.forEach(job => {
    msg += `🆔 *Job ID:* \`${job.jobId}\`\n`;
    msg += `• *Bot:* \`${job.botSlug || 'unknown'}\`\n`;
    msg += `• *Status:* \`${job.status.toUpperCase()}\`\n`;
    msg += `• *File:* ${job.filename ? '`' + job.filename + '`' : '`none`'}\n`;
    msg += `• *Published:* \`${job.published ? 'yes' : 'no'}\`\n`;
    if (job.summaryPreview) {
      msg += `• *Summary:* ${job.summaryPreview}\n`;
    }
    msg += `• *Next Command:* /run_job ${job.jobId}\n\n`;
  });
  return msg.trim();
}

async function handleRunByBot(botSlug, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/run_by_bot', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/run_by_bot', permCheck.reason, message);
  }

  if (!botSlug || !botSlug.trim()) {
    return `❌ Usage: /run_by_bot <bot_slug>\nExample: /run_by_bot content-forge`;
  }

  const cleanSlug = botSlug.trim();
  const { isBotAllowed } = require('../../openclaw/runtime/runtime-allowlist');
  if (!isBotAllowed(cleanSlug)) {
    return `❌ Rejection: Bot '${cleanSlug}' is not in the approved runtime bots list.`;
  }

  const { getJobsByBot } = require('../../openclaw/runtime/runtime-job-index');
  const results = getJobsByBot(cleanSlug);
  if (results.length === 0) {
    return `No runtime jobs found for bot '${cleanSlug}'.`;
  }

  let msg = `🤖 *Recent Jobs for "${cleanSlug}" (Max 5)*\n\n`;
  results.forEach(job => {
    msg += `🆔 *Job ID:* \`${job.jobId}\`\n`;
    msg += `• *Command:* \`${job.command || 'unknown'}\`\n`;
    msg += `• *Status:* \`${job.status.toUpperCase()}\`\n`;
    msg += `• *File:* ${job.filename ? '`' + job.filename + '`' : '`none`'}\n`;
    msg += `• *Published:* \`${job.published ? 'yes' : 'no'}\`\n`;
    msg += `• *Created:* \`${job.created || 'unknown'}\`\n`;
    msg += `• *Next Command:* /run_job ${job.jobId}\n\n`;
  });
  return msg.trim();
}

async function handleRunReindex(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/run_reindex', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/run_reindex', permCheck.reason, message);
  }

  const { rebuildJobIndex } = require('../../openclaw/runtime/runtime-job-index');
  const stats = rebuildJobIndex();

  let msg = `🔄 *Job Index Rebuilt Successfully*\n\n`;
  msg += `• *Jobs Indexed:* \`${stats.jobsIndexed}\`\n`;
  msg += `• *Events Scanned:* \`${stats.eventsScanned}\`\n`;
  msg += `• *Result Files Scanned:* \`${stats.resultFilesScanned}\`\n`;
  msg += `• *Errors Skipped:* \`${stats.errorsSkipped}\`\n`;
  msg += `• *Timestamp:* \`${stats.timestamp}\`\n\n`;
  msg += `Next command: /run_search <keyword>`;
  return msg;
}

async function handleRunPermissions(message) {
  const { requireCommandPermission, formatPermissionDenied, getPermissionSummary } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/run_permissions', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/run_permissions', permCheck.reason, message);
  }
  return getPermissionSummary();
}

async function handleRunRoles(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/run_roles', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/run_roles', permCheck.reason, message);
  }

  const roles = require('../../openclaw/runtime/runtime-roles');
  const summary = roles.getRoleSummary();

  let msg = `👥 *OpenClaw Role Configuration Summary*\n\n`;
  msg += `• *Role System:* Enabled\n`;
  msg += `• *Backward Compatibility Fallback:* ${summary.fallbackActive ? 'Active' : 'Inactive'}\n\n`;
  msg += `*Role Counts:*\n`;
  msg += `• *super_admin:* ${summary.super_admin}\n`;
  msg += `• *operator:* ${summary.operator}\n`;
  msg += `• *publisher:* ${summary.publisher}\n`;
  msg += `• *approver:* ${summary.approver}\n`;
  msg += `• *viewer:* ${summary.viewer}\n\n`;
  msg += `*Capability groups:* Enabled\n`;
  msg += `*Next command:* /run_permissions`;
  return msg;
}

async function handleMyRole(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/my_role', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/my_role', permCheck.reason, message);
  }

  const senderChatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const roles = require('../../openclaw/runtime/runtime-roles');
  const userRoles = roles.getRolesForChatId(senderChatId);
  const userCaps = Array.from(roles.getEffectiveCapabilities(senderChatId));

  let msg = `👤 *Your Effective Role & Capabilities*\n\n`;
  msg += `• *Your Roles:* ${userRoles.length > 0 ? userRoles.join(', ') : 'none'}\n`;
  msg += `• *Effective Capabilities:* ${userCaps.length > 0 ? userCaps.join(', ') : 'none'}\n`;
  msg += `• *Access Model:* role-based`;
  return msg;
}

async function handleConnectorList(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/connector_list', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/connector_list', permCheck.reason, message);
  }

  const { listConnectors } = require('../../openclaw/runtime/connector-registry');
  const connectors = listConnectors();

  let msg = "🔌 *OpenClaw Connector Registry*\n\n";
  for (const c of connectors) {
    msg += `• *Connector:* \`${c.connectorId}\` (${c.name})\n`;
    msg += `  *Execution:* \`Disabled\` | *Status:* \`${c.status.toUpperCase()}\`\n`;
    msg += `  *Actions:* ${c.supportedDryRunActions.map(a => `\`${a}\``).join(', ')}\n\n`;
  }
  msg += "Use `/connector_info <id>` to inspect details.";
  return msg;
}

async function handleConnectorInfo(connectorId, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/connector_info', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/connector_info', permCheck.reason, message);
  }

  if (!connectorId || !connectorId.trim()) {
    return "❌ Usage: /connector_info <connector_id>\nExample: /connector_info ghl";
  }

  const { getConnector } = require('../../openclaw/runtime/connector-registry');
  const c = getConnector(connectorId);
  if (!c) {
    return `❌ Unknown connector ID: '${connectorId.trim()}'. Use /connector_list to list connectors.`;
  }

  let msg = `🔌 *Connector Info: ${c.name}*\n\n`;
  msg += `• *ID:* \`${c.connectorId}\`\n`;
  msg += `• *Status:* \`${c.status.toUpperCase()}\`\n`;
  msg += `• *Real Execution:* \`Disabled\`\n`;
  msg += `• *Sandbox Configured:* \`${c.sandboxReady ? 'yes' : 'no'}\`\n`;
  msg += `• *Required Env Vars:* ${c.requiredEnvVars.map(e => `\`${e}\``).join(', ')}\n`;
  msg += `• *Dry-Run Actions:* ${c.supportedDryRunActions.map(a => `\`${a}\``).join(', ')}\n`;
  msg += `• *Notes:* ${c.notes}\n`;
  msg += `• *Safety Boundary:* ${c.safetyBoundary}\n\n`;
  msg += `*Next Command:* \`/connector_validate ${c.connectorId}\``;
  return msg;
}

async function handleConnectorValidate(connectorId, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/connector_validate', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/connector_validate', permCheck.reason, message);
  }

  if (!connectorId || !connectorId.trim()) {
    return "❌ Usage: /connector_validate <connector_id>\nExample: /connector_validate ghl";
  }

  const { getConnector, validateConnector } = require('../../openclaw/runtime/connector-registry');
  const c = getConnector(connectorId);
  if (!c) {
    return `❌ Unknown connector ID: '${connectorId.trim()}'.`;
  }

  const val = validateConnector(connectorId);
  
  let msg = `🔍 *Connector Validation: ${c.name}*\n\n`;
  msg += `• *ID:* \`${c.connectorId}\`\n`;
  msg += `• *Status:* \`${val.valid ? '🟢 VALID' : '🔴 INVALID (Missing Env Vars)'}\`\n\n`;
  msg += `*Environment Checks:*\n`;
  
  for (const envVar of val.requiredEnvVars) {
    const present = !val.missingEnvVars.includes(envVar);
    msg += `• \`${envVar}\`: ${present ? '✅ Present' : '❌ Missing'}\n`;
  }
  
  msg += `\n*Note:* No network or API connections were initiated. This is a configuration status check.`;
  return msg;
}

async function handlePresetList(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/preset_list', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/preset_list', permCheck.reason, message);
  }

  const { listPresets } = require('../../openclaw/runtime/runtime-presets');
  const presets = listPresets();

  if (presets.length === 0) {
    return "No runtime presets configured.";
  }

  let msg = "📋 *OpenClaw Runtime Presets*\n\n";
  for (const preset of presets) {
    msg += `• *ID:* \`${preset.id}\`\n`;
    msg += `  *Bot:* \`${preset.bot}\` | *Mode:* \`${preset.mode}\`\n`;
    msg += `  *Desc:* ${preset.safetyNotes || 'No description'}\n`;
    msg += `  *Usage:* \`${preset.example}\`\n\n`;
  }

  msg += "Use `/preset_info <preset_id>` to view full details.";
  return msg;
}

async function handlePresetInfo(presetId, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/preset_info', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/preset_info', permCheck.reason, message);
  }

  if (!presetId || !presetId.trim()) {
    return "❌ Missing preset ID.\nUsage: /preset_info <preset_id>\nExample: /preset_info cleaning_lead_plan";
  }

  const { getPreset } = require('../../openclaw/runtime/runtime-presets');
  const preset = getPreset(presetId.trim());

  if (!preset) {
    return `❌ Rejection: Unknown preset ID '${presetId.trim()}'. Use /preset_list to see available options.`;
  }

  let msg = `🎯 *Preset Info: ${preset.name}*\n\n`;
  msg += `• *Preset ID:* \`${presetId.trim()}\`\n`;
  msg += `• *Bot Slug:* \`${preset.bot}\`\n`;
  msg += `• *Mode:* \`${preset.mode}\`\n`;
  msg += `• *Variables:* [${preset.variables.map(v => `\`${v}\``).join(', ')}]\n`;
  msg += `• *Safety Notes:* ${preset.safetyNotes || 'None'}\n`;
  msg += `• *Example:* \`${preset.example}\`\n`;
  msg += `• *Allowed for Publishing:* \`${preset.allowedPublish ? 'yes' : 'no'}\`\n\n`;
  msg += `*Template:* \n\`\`\`\n${preset.template}\n\`\`\`\n\n`;
  msg += `*Run Command:* \n\`/run_preset ${presetId.trim()} <input>\``;
  if (preset.allowedPublish) {
    msg += `\n\`/run_preset_publish ${presetId.trim()} <input>\``;
  }
  return msg;
}

async function handleRunPreset(text, message) {
  const trimmed = text.trim();
  const commandWord = trimmed.split(/\s+/)[0];
  const commandTextWithoutCmd = trimmed.substring(commandWord.length).trim();

  const firstSpaceIdx = commandTextWithoutCmd.search(/\s/);
  let presetId = '';
  let input = '';
  if (firstSpaceIdx === -1) {
    presetId = commandTextWithoutCmd;
    input = '';
  } else {
    presetId = commandTextWithoutCmd.substring(0, firstSpaceIdx).trim();
    input = commandTextWithoutCmd.substring(firstSpaceIdx).trim();
  }

  const { runPreset } = require('../../openclaw/runtime/runtime-presets');
  const senderChatId = message.chat?.id || '';
  const result = await runPreset(presetId, input, senderChatId);
  return result.message;
}

async function handleRunPresetPublish(text, message, approvalId = null) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/run_preset_publish', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/run_preset_publish', permCheck.reason, message);
  }

  const trimmed = text.trim();
  const commandWord = trimmed.split(/\s+/)[0];
  const commandTextWithoutCmd = trimmed.substring(commandWord.length).trim();

  const firstSpaceIdx = commandTextWithoutCmd.search(/\s/);
  let presetId = '';
  let input = '';
  if (firstSpaceIdx === -1) {
    presetId = commandTextWithoutCmd;
    input = '';
  } else {
    presetId = commandTextWithoutCmd.substring(0, firstSpaceIdx).trim();
    input = commandTextWithoutCmd.substring(firstSpaceIdx).trim();
  }

  // Reject missing preset ID
  if (!presetId) {
    return `❌ Missing preset ID.\nUsage: /run_preset_publish <preset_id> <input>\nExample: /run_preset_publish publish_content_hooks Cresca OS`;
  }

  // Reject empty input
  if (!input || !input.trim()) {
    return `❌ Rejection: Input parameters cannot be empty.\nUsage: /run_preset_publish ${presetId} <input>`;
  }

  // Confirm preset is allowed for publishing
  const { getPreset } = require('../../openclaw/runtime/runtime-presets');
  const preset = getPreset(presetId);
  if (!preset) {
    return `❌ Rejection: Unknown preset ID '${presetId}'. Use /preset_list to see available options.`;
  }
  if (!preset.allowedPublish) {
    return `❌ Rejection: Preset '${presetId}' is not authorized for direct publishing. Only presets configured with allowedPublish=true can use /run_preset_publish.`;
  }

  if (!approvalId && process.env.OPENCLAW_NO_APPROVAL_GATE !== 'true') {
    // Intercept to create approval
    const { createApproval } = require('../../openclaw/runtime/runtime-approvals');
    const record = createApproval(
      message.chat?.id,
      'run_preset_publish',
      'publish',
      null,
      presetId,
      input.substring(0, 200),
      { text, message }
    );

    return [
      `Approval Required`,
      `Approval ID: ${record.approvalId}`,
      `Command: run_preset_publish`,
      `Preset: ${record.presetId}`,
      `Preview: ${record.inputPreview}`,
      `Expires: ${new Date(record.expiresAt).toISOString()}`,
      `To approve:`,
      ` /approve_run ${record.approvalId}`,
      ``,
      `To reject:`,
      ` /reject_run ${record.approvalId}`
    ].join('\n');
  }

  return await executeRunPresetPublish(text, message, approvalId);
}

// ------------------------------------------
// Dry-Run Mode Command Handlers
// ------------------------------------------

async function handleDryRunTypes(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/dryrun_types', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/dryrun_types', permCheck.reason, message);
  }

  const { listDryRunTypes } = require('../../openclaw/runtime/runtime-dryrun');
  const types = listDryRunTypes();

  let msg = "📋 *Supported Dry-Run Action Types*\n\n";
  for (const t of types) {
    msg += `• *${t.actionType}*\n`;
    msg += `  *Desc:* ${t.description}\n`;
    msg += `  *Required Fields:* ${t.requiredFields.join(', ')}\n`;
    msg += `  *Example:* \`${t.example}\`\n\n`;
  }
  msg += "Use `/dryrun_action <type> <request>` to run a simulation.";
  return msg;
}

async function handleDryRunHistory(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/dryrun_history', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/dryrun_history', permCheck.reason, message);
  }

  const { getDryRunHistory } = require('../../openclaw/runtime/runtime-dryrun');
  const history = getDryRunHistory(10);

  if (history.length === 0) {
    return "No dry-run history found.";
  }

  let msg = "📜 *Recent Dry-Run History (Last 10)*\n\n";
  history.forEach((record, index) => {
    msg += `${index + 1}. \`${record.dryrunId}\`\n`;
    msg += `   • *Action:* \`${record.actionType}\` | *Status:* \`${record.status}\`\n`;
    msg += `   • *Job ID:* \`${record.jobId}\`\n`;
    msg += `   • *File:* \`${record.filename}\`\n`;
    msg += `   • *Time:* ${record.createdAt}\n\n`;
  });
  return msg.trim();
}

async function handleDryRunInfo(dryrunId, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/dryrun_info', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/dryrun_info', permCheck.reason, message);
  }

  if (!dryrunId || !dryrunId.trim()) {
    return "❌ Missing Dry-Run ID. Usage: /dryrun_info <dryrun_id>";
  }

  const { getDryRunRecord, isValidDryRunId } = require('../../openclaw/runtime/runtime-dryrun');
  const cleanId = dryrunId.trim();
  if (!isValidDryRunId(cleanId)) {
    return "❌ Error: Dry-run record not found or invalid format.";
  }

  const record = getDryRunRecord(cleanId);
  if (!record) {
    return "❌ Error: Dry-run record not found or invalid format.";
  }

  const validationStatus = record.validation.success ? 'Passed' : 'Failed (Missing: ' + record.validation.missingFields.join(', ') + ')';

  let msg = `🎯 *Dry-Run Info: ${record.dryrunId}*\n\n`;
  msg += `• *Job ID:* \`${record.jobId}\`\n`;
  msg += `• *Action Type:* \`${record.actionType}\`\n`;
  msg += `• *Status:* \`DRY_RUN_ONLY\`\n`;
  msg += `• *Created:* ${record.createdAt}\n`;
  msg += `• *File:* \`${record.filename}\`\n`;
  msg += `• *Validation:* ${validationStatus}\n`;
  msg += `• *External Execution:* \`Disabled\`\n\n`;
  msg += `*Next commands:*\n`;
  msg += `• \`/run_job ${record.jobId}\`\n`;
  msg += `• \`/dryrun_history\``;
  return msg;
}

async function handleDryRunAction(text, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/dryrun_action', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/dryrun_action', permCheck.reason, message);
  }

  const trimmed = text.trim();
  const commandWord = trimmed.split(/\s+/)[0];
  const commandTextWithoutCmd = trimmed.substring(commandWord.length).trim();

  const firstSpaceIdx = commandTextWithoutCmd.search(/\s/);
  let actionType = '';
  let request = '';
  if (firstSpaceIdx === -1) {
    actionType = commandTextWithoutCmd;
    request = '';
  } else {
    actionType = commandTextWithoutCmd.substring(0, firstSpaceIdx).trim();
    request = commandTextWithoutCmd.substring(firstSpaceIdx).trim();
  }

  if (!actionType) {
    return "❌ Missing action type.\nUsage: /dryrun_action <action_type> <request>";
  }

  const { validateDryRunActionType, createDryRunPreview, formatDryRunForTelegram } = require('../../openclaw/runtime/runtime-dryrun');
  if (!validateDryRunActionType(actionType)) {
    return `❌ Invalid action type: '${actionType}'. Use /dryrun_types to list supported action types.`;
  }

  if (!request || !request.trim()) {
    return `❌ Missing request text for action type: ${actionType}.\nUsage: /dryrun_action ${actionType} <request>`;
  }

  const { generateRuntimeJobId } = require('../../openclaw/runtime/runtime-job-id');
  const jobId = generateRuntimeJobId();

  try {
    const record = createDryRunPreview(actionType, request, { jobId, botSlug: 'tech-dryrun' });
    return formatDryRunForTelegram(record);
  } catch (err) {
    return `❌ Error generating dry-run preview: ${err.message}`;
  }
}

async function handleDryRunPublish(text, message, approvalId = null) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/dryrun_publish', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/dryrun_publish', permCheck.reason, message);
  }

  const trimmed = text.trim();
  const commandWord = trimmed.split(/\s+/)[0];
  const commandTextWithoutCmd = trimmed.substring(commandWord.length).trim();

  const firstSpaceIdx = commandTextWithoutCmd.search(/\s/);
  let actionType = '';
  let request = '';
  if (firstSpaceIdx === -1) {
    actionType = commandTextWithoutCmd;
    request = '';
  } else {
    actionType = commandTextWithoutCmd.substring(0, firstSpaceIdx).trim();
    request = commandTextWithoutCmd.substring(firstSpaceIdx).trim();
  }

  if (!actionType) {
    return "❌ Missing action type.\nUsage: /dryrun_publish <action_type> <request>";
  }

  const { validateDryRunActionType } = require('../../openclaw/runtime/runtime-dryrun');
  if (!validateDryRunActionType(actionType)) {
    return `❌ Invalid action type: '${actionType}'. Use /dryrun_types to list supported action types.`;
  }

  if (!request || !request.trim()) {
    return `❌ Missing request text for action type: ${actionType}.\nUsage: /dryrun_publish ${actionType} <request>`;
  }

  if (!approvalId && process.env.OPENCLAW_NO_APPROVAL_GATE !== 'true') {
    const { createApproval } = require('../../openclaw/runtime/runtime-approvals');
    const record = createApproval(
      message.chat?.id,
      'dryrun_publish',
      'publish',
      null,
      null,
      `${actionType}: ${request.substring(0, 100)}`,
      { text, message }
    );

    return [
      `Approval Required`,
      `Approval ID: ${record.approvalId}`,
      `Command: dryrun_publish`,
      `Preview: ${record.inputPreview}`,
      `Expires: ${new Date(record.expiresAt).toISOString()}`,
      `To approve:`,
      ` /approve_run ${record.approvalId}`,
      ``,
      `To reject:`,
      ` /reject_run ${record.approvalId}`
    ].join('\n');
  }

  return await executeDryRunPublish(text, message, approvalId);
}

async function executeDryRunPublish(text, message, approvalId) {
  const trimmed = text.trim();
  const commandWord = trimmed.split(/\s+/)[0];
  const commandTextWithoutCmd = trimmed.substring(commandWord.length).trim();

  const firstSpaceIdx = commandTextWithoutCmd.search(/\s/);
  let actionType = '';
  let request = '';
  if (firstSpaceIdx === -1) {
    actionType = commandTextWithoutCmd;
    request = '';
  } else {
    actionType = commandTextWithoutCmd.substring(0, firstSpaceIdx).trim();
    request = commandTextWithoutCmd.substring(firstSpaceIdx).trim();
  }

  const { generateRuntimeJobId } = require('../../openclaw/runtime/runtime-job-id');
  const jobId = generateRuntimeJobId();

  const { createDryRunPreview } = require('../../openclaw/runtime/runtime-dryrun');
  const { transitionToExecuted, transitionToExecutionFailed } = require('../../openclaw/runtime/runtime-approvals');

  let record;
  try {
    record = createDryRunPreview(actionType, request, { jobId, botSlug: 'tech-dryrun' });
  } catch (err) {
    transitionToExecutionFailed(approvalId, `Dry-run generation failed: ${err.message}`);
    return `❌ Dry-run generation failed: ${err.message}`;
  }

  let workspaceRoot = process.env.OPENCLAW_WORKSPACE_ROOT;
  if (!workspaceRoot || !fs.existsSync(path.join(workspaceRoot, 'openclaw'))) {
    workspaceRoot = path.join(__dirname, '../../');
  }
  const exactFilePath = path.join(workspaceRoot, 'openclaw', 'outbox', 'telegram-responses', record.filename);

  let publishResult;
  try {
    publishResult = await drivePublisher.publishExactRuntimeFile(exactFilePath, { bot: 'tech-dryrun', jobId });
  } catch (err) {
    transitionToExecutionFailed(approvalId, `Drive publish failed: ${err.message}`);
    return [
      `✅ *Dry-run successful!*`,
      `📄 *File:* \`${record.filename}\``,
      ``,
      `⚠️ *Drive Publish Failed:* ${err.message}`
    ].join('\n');
  }

  const driveLink = publishResult.drive_web_url || publishResult.drive_local_path || '(local sync — no API link)';

  // Log dryrun_published event
  const { logEvent } = require('../../openclaw/runtime/runtime-logger');
  logEvent({
    event: 'dryrun_published',
    dryrunId: record.dryrunId,
    jobId,
    actionType,
    status: 'DRY_RUN_ONLY',
    filename: record.filename,
    published: true,
    driveLink
  });

  const resultMsg = [
    `✅ *Dry-Run + Publish Complete!*`,
    ``,
    `🆔 *Job ID:* \`${jobId}\``,
    `🧪 *Dry-Run ID:* \`${record.dryrunId}\``,
    `📄 *File:* \`${record.filename}\``,
    `🚦 *Drive Status:* PUBLISHED`,
    `🔗 *Drive Link:* ${driveLink}`,
    ``,
    `Next command: /drive_latest`
  ].join('\n');

  transitionToExecuted(approvalId, jobId, record.filename, driveLink, resultMsg);
  return resultMsg;
}

// ------------------------------------------
// Google Drive Publisher Command Handlers
// ------------------------------------------

function getLatestManifest() {
  const roots = getActiveRoots();
  const candidates = [];
  
  roots.forEach(rootDir => {
    const syncDir = path.join(rootDir, 'openclaw', 'outbox', 'google-drive-sync');
    if (!fs.existsSync(syncDir)) return;
    
    const files = fs.readdirSync(syncDir).filter(f => f.startsWith('publish_manifest_') && f.endsWith('.json'));
    files.forEach(filename => {
      const fullPath = path.join(syncDir, filename);
      let mtime = 0;
      try {
        mtime = fs.statSync(fullPath).mtimeMs;
        candidates.push({ filename, fullPath, mtime });
      } catch (e) {}
    });
  });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.mtime - a.mtime);
  try {
    return JSON.parse(fs.readFileSync(candidates[0].fullPath, 'utf8'));
  } catch (e) {
    return null;
  }
}


async function handleDriveLatest(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/drive_latest', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/drive_latest', permCheck.reason, message);
  }

  const manifest = getLatestManifest();
  if (!manifest) {
    return "No Google Drive publishing history found yet.\nRun /drive_publish_latest to publish your first asset!";
  }
  
  let msg = "📂 *Latest Google Drive Publication*\n\n";
  msg += "📄 *File:* `" + path.basename(manifest.local_file) + "`\n";
  msg += "📁 *Project:* " + manifest.project + "\n";
  msg += "📣 *Campaign:* " + manifest.campaign + "\n";
  msg += "⚙️ *Mode:* `" + manifest.publish_mode + "`\n";
  msg += "🚦 *Status:* `" + manifest.status.toUpperCase() + "`\n";
  
  if (manifest.status === 'published') {
    if (manifest.publish_mode === 'api' && manifest.drive_web_url) {
      msg += "🔗 *Drive Link:* " + manifest.drive_web_url + "\n";
    } else if (manifest.publish_mode === 'local' && manifest.drive_local_path) {
      msg += "💻 *Local Path:* `" + manifest.drive_local_path + "`\n";
      msg += "ℹ️ *Google Drive Desktop will sync this file to your Drive.*";
    }
  } else if (manifest.status === 'dry_run') {
    msg += "⚠️ *Dry Run:* " + (manifest.error || 'API library or credentials missing.');
  } else {
    msg += "❌ *Error:* " + (manifest.error || 'Unknown error occurred.');
  }
  
  return msg;
}

function getFilePriority(fullPath, rootDir) {
  const normPath = fullPath.replace(/\\/g, '/');
  const baseName = path.basename(fullPath).toLowerCase();
  
  // Exclusions:
  if (baseName === '.gitkeep') return 0;
  if (baseName.endsWith('_manifest.json') || baseName.includes('publish_manifest')) return 0;
  if (normPath.includes('/google-drive-sync/') || normPath.includes('/inbox/') || normPath.includes('/node_modules/') || normPath.includes('/.git/')) return 0;

  const ext = path.extname(fullPath).toLowerCase();
  const allowedExts = ['.md', '.txt', '.json', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.mp4', '.mov', '.csv'];
  if (!allowedExts.includes(ext)) return 0;

  // Resolve absolute paths to classify:
  const absPath = path.resolve(fullPath);
  
  const responsesDir = path.resolve(rootDir, 'openclaw/outbox/telegram-responses');
  const reportsDir = path.resolve(rootDir, 'openclaw/reports');
  const campaignsDir = path.resolve(rootDir, 'campaigns');

  if (absPath.startsWith(responsesDir + path.sep) || absPath === responsesDir) {
    if (baseName.endsWith('_result.md')) return 5;
    if (ext === '.md') return 4;
  }
  if (absPath.startsWith(reportsDir + path.sep) || absPath === reportsDir) {
    if (ext === '.md') return 3;
  }
  if (absPath.startsWith(campaignsDir + path.sep) || absPath === campaignsDir) {
    if (ext === '.md') return 2;
    const mediaExts = ['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.mov', '.pdf', '.csv'];
    if (mediaExts.includes(ext)) return 1;
  }

  return 0;
}

function isValidRepoRoot(candidate) {
  if (!candidate || !fs.existsSync(candidate)) return false;
  // Strong marker: openclaw/bots/registry.md
  if (fs.existsSync(path.join(candidate, 'openclaw', 'bots', 'registry.md'))) return true;
  // Fallback markers: server.js + package.json
  if (fs.existsSync(path.join(candidate, 'server.js')) && fs.existsSync(path.join(candidate, 'package.json'))) return true;
  return false;
}

function getActiveRoots() {
  const roots = [];
  const envRoot = process.env.OPENCLAW_WORKSPACE_ROOT;

  if (process.env.OPENCLAW_TEST === 'true') {
    // Test mode: trust the env root without marker validation (sandbox)
    if (envRoot) {
      roots.push(path.resolve(envRoot));
    }
    return roots;
  }

  // Production mode: validate each candidate with repo markers
  // 1. OPENCLAW_WORKSPACE_ROOT (if valid)
  if (envRoot && isValidRepoRoot(path.resolve(envRoot))) {
    roots.push(path.resolve(envRoot));
  }

  // 2. __dirname-derived app root
  const appRoot = path.resolve(__dirname, '../../');
  if (isValidRepoRoot(appRoot)) {
    roots.push(appRoot);
  }

  // 3. Hardcoded /app fallback (Railway)
  const railwayRoot = '/app';
  if (isValidRepoRoot(railwayRoot)) {
    roots.push(railwayRoot);
  }

  // 4. process.cwd() fallback
  const cwdRoot = process.cwd();
  if (isValidRepoRoot(cwdRoot)) {
    roots.push(cwdRoot);
  }

  const unique = [...new Set(roots)];
  if (unique.length === 0) {
    console.error('[getActiveRoots] WARNING: No valid OpenClaw repo root found. Candidates tried: envRoot=' + (envRoot || 'unset') + ', appRoot=' + appRoot + ', /app, cwd=' + cwdRoot);
  }
  return unique;
}

function getLatestOutputFile() {
  const roots = getActiveRoots();
  // App Root for priority checks fallback
  const appRoot = path.resolve(__dirname, '../../');
  const envRoot = process.env.OPENCLAW_WORKSPACE_ROOT;

  const approvedPaths = [];
  roots.forEach(rootDir => {
    approvedPaths.push(path.resolve(rootDir, 'openclaw/outbox/telegram-responses'));
    approvedPaths.push(path.resolve(rootDir, 'openclaw/reports'));
    approvedPaths.push(path.resolve(rootDir, 'campaigns'));
  });

  const candidates = [];

  function traverse(dir) {
    if (!fs.existsSync(dir)) return;
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) return;

    // Skip node_modules, git, and sync folders
    const normDir = dir.replace(/\\/g, '/');
    if (normDir.includes('node_modules') || normDir.includes('.git') || normDir.includes('google-drive-sync') || normDir.includes('/inbox/')) {
      return;
    }

    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      try {
        const itemStat = fs.statSync(fullPath);
        if (itemStat.isFile()) {
          // Check file priority using the root that matches
          let matchingRoot = appRoot;
          if (envRoot && fullPath.startsWith(path.resolve(envRoot))) {
            matchingRoot = path.resolve(envRoot);
          }
          
          const priority = getFilePriority(fullPath, matchingRoot);
          if (priority > 0) {
            candidates.push({
              path: fullPath,
              mtimeMs: itemStat.mtimeMs,
              priority: priority
            });
          }
        } else if (itemStat.isDirectory()) {
          traverse(fullPath);
        }
      } catch (e) {}
    }
  }

  // Remove duplicate search paths if any
  const uniqueApprovedPaths = [...new Set(approvedPaths)];
  uniqueApprovedPaths.forEach(traverse);

  if (candidates.length === 0) return null;

  // Sort by priority tier descending, then by mtimeMs descending
  candidates.sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    return b.mtimeMs - a.mtimeMs;
  });

  return candidates[0].path;
}

async function handleDrivePublishLatest(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/drive_publish_latest', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/drive_publish_latest', permCheck.reason, message);
  }

  // Uses publishLatestToDrive() which includes manifest-based duplicate detection.
  // If already published, returns the existing Drive link instead of re-uploading.
  const result = await drivePublisher.publishLatestToDrive();

  if (result.status === 'no_file') {
    return "No generated output file found yet.\n\nProcess an inbox request first, then run /drive_publish_latest.";
  }

  if (result.status === 'already_published') {
    let msg = "⚠️ *Already Published — No Duplicate Upload*\n\n";
    msg += "📄 *File:* `" + path.basename(result.file) + "`\n";
    msg += "🔗 *Existing Link:* " + result.drive_link + "\n\n";
    msg += "To force a new upload, use:\n/drive_republish_latest\n\n";
    msg += "To publish only a NEW unpublished file, use:\n/drive_publish_pending";
    return msg;
  }

  if (result.status === 'error') {
    return "❌ *Error:* " + result.message;
  }

  let msg = "📤 *Google Drive Publish Result*\n\n";
  msg += "📄 *File:* `" + path.basename(result.file || '') + "`\n";
  msg += "🚦 *Status:* `" + result.status.toUpperCase() + "`\n";

  if (result.status === 'published') {
    const m = result.manifest || {};
    if (m.publish_mode === 'api' && m.drive_web_url) {
      msg += "🔗 *Drive Link:* " + m.drive_web_url + "\n";
    } else if (m.publish_mode === 'local' && m.drive_local_path) {
      msg += "💻 *Local Path:* `" + m.drive_local_path + "`\n";
      msg += "ℹ️ *Google Drive Desktop will sync this file to your Drive.*";
    }
  } else if (result.status === 'dry_run') {
    msg += "⚠️ *Dry Run (No Upload):* " + (result.manifest && result.manifest.error ? result.manifest.error : result.message);
  } else {
    msg += "❌ *Publish Failed:* " + result.message;
  }

  return msg;
}

async function handleDrivePublishPending(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/drive_publish_pending', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/drive_publish_pending', permCheck.reason, message);
  }

  // Finds and publishes only the latest unpublished output file.
  const result = await drivePublisher.publishPendingToDrive();

  if (result.status === 'no_file' || result.status === 'no_pending') {
    let msg = "ℹ️ *No Unpublished Files Found*\n\n";
    msg += result.message;
    return msg;
  }

  if (result.status === 'error') {
    return "❌ *Error:* " + result.message;
  }

  let msg = "📤 *Google Drive Publish Pending Result*\n\n";
  msg += "📄 *File:* `" + path.basename(result.file || '') + "`\n";
  msg += "🚦 *Status:* `" + result.status.toUpperCase() + "`\n";

  if (result.status === 'published') {
    const m = result.manifest || {};
    if (m.publish_mode === 'api' && m.drive_web_url) {
      msg += "🔗 *Drive Link:* " + m.drive_web_url + "\n";
    } else if (m.publish_mode === 'local' && m.drive_local_path) {
      msg += "💻 *Local Path:* `" + m.drive_local_path + "`\n";
      msg += "ℹ️ *Google Drive Desktop will sync this file to your Drive.*";
    }
  } else if (result.status === 'dry_run') {
    msg += "⚠️ *Dry Run (No Upload):* " + (result.manifest && result.manifest.error ? result.manifest.error : result.message);
  } else {
    msg += "❌ *Publish Failed:* " + result.message;
  }

  return msg;
}

async function handleDriveRepublishLatest(message, approvalId = null) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/drive_republish_latest', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/drive_republish_latest', permCheck.reason, message);
  }

  if (!approvalId && process.env.OPENCLAW_NO_APPROVAL_GATE !== 'true') {
    const { createApproval } = require('../../openclaw/runtime/runtime-approvals');
    const record = createApproval(
      message.chat?.id,
      'drive_republish_latest',
      'publish',
      null,
      null,
      'Force republishing of the latest output file.',
      {}
    );

    return [
      `Approval Required`,
      `Approval ID: ${record.approvalId}`,
      `Command: drive_republish_latest`,
      `Preview: ${record.inputPreview}`,
      `Expires: ${new Date(record.expiresAt).toISOString()}`,
      `To approve:`,
      ` /approve_run ${record.approvalId}`,
      ``,
      `To reject:`,
      ` /reject_run ${record.approvalId}`
    ].join('\n');
  }

  return await executeDriveRepublishLatest(message, approvalId);
}

async function executeDriveRepublishLatest(message, approvalId) {
  const { transitionToExecuted, transitionToExecutionFailed } = require('../../openclaw/runtime/runtime-approvals');
  try {
    const result = await drivePublisher.republishLatestToDrive();

    if (result.status === 'no_file') {
      transitionToExecutionFailed(approvalId, 'No generated output file found to republish.');
      return "No generated output file found to republish.";
    }

    if (result.status === 'error') {
      transitionToExecutionFailed(approvalId, result.message);
      return "❌ *Error:* " + result.message;
    }

    let msg = "🔄 *Google Drive Force Republish Result*\n\n";
    msg += "📄 *File:* `" + path.basename(result.file || '') + "`\n";
    msg += "🚦 *Status:* `" + result.status.toUpperCase() + "`\n";

    let driveLink = null;
    if (result.status === 'published') {
      const m = result.manifest || {};
      if (m.publish_mode === 'api' && m.drive_web_url) {
        msg += "🔗 *Drive Link:* " + m.drive_web_url + "\n";
        driveLink = m.drive_web_url;
      } else if (m.publish_mode === 'local' && m.drive_local_path) {
        msg += "💻 *Local Path:* `" + m.drive_local_path + "`\n";
        msg += "ℹ️ *Google Drive Desktop will sync this file to your Drive.*";
        driveLink = m.drive_local_path;
      }
    } else if (result.status === 'dry_run') {
      msg += "⚠️ *Dry Run (No Upload):* " + (result.manifest && result.manifest.error ? result.manifest.error : result.message);
    } else {
      msg += "❌ *Republish Failed:* " + result.message;
    }

    if (result.status === 'published' || result.status === 'dry_run') {
      transitionToExecuted(approvalId, null, path.basename(result.file || ''), driveLink, msg);
    } else {
      transitionToExecutionFailed(approvalId, result.message || 'Republish failed');
    }

    return msg;
  } catch (err) {
    transitionToExecutionFailed(approvalId, err.message);
    return `❌ Republish failed: ${err.message}`;
  }
}

async function handleDrivePublishFile(filename, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/drive_publish_file', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/drive_publish_file', permCheck.reason, message);
  }

  if (!filename) {
    return "Usage: /drive_publish_file <filename>\nExample: /drive_publish_file 2026-05-26_17-40-18_content-forge_image-prompts_result.md";
  }

  const base = path.basename(filename);
  if (filename !== base) {
    return "❌ Access denied: Path traversal or invalid characters detected.";
  }

  const ext = path.extname(base).toLowerCase();
  const allowedExts = ['.md', '.txt', '.json', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.mp4', '.mov', '.csv'];
  if (!allowedExts.includes(ext)) {
    return "❌ Access denied: Unsupported file extension.";
  }

  if (base.endsWith('_manifest.json') || base.includes('publish_manifest')) {
    return "❌ Access denied: Cannot publish internal manifest files.";
  }

  let rootDir = process.env.OPENCLAW_WORKSPACE_ROOT;
  if (!rootDir || !fs.existsSync(path.join(rootDir, 'openclaw'))) {
    rootDir = path.join(__dirname, '../../');
  }
  
  const targetPath = path.join(rootDir, 'openclaw', 'outbox', 'telegram-responses', base);
  if (!fs.existsSync(targetPath)) {
    return `❌ File not found in responses directory: ${base}`;
  }

  const options = {};
  const manifest = await drivePublisher.publishFileToDrive(targetPath, options);

  let msg = "📤 *Google Drive Publish Result*\n\n";
  msg += "📄 *File:* `" + base + "`\n";
  msg += "🚦 *Status:* `" + manifest.status.toUpperCase() + "`\n";

  if (manifest.status === 'published') {
    if (manifest.publish_mode === 'api' && manifest.drive_web_url) {
      msg += "🔗 *Drive Link:* " + manifest.drive_web_url + "\n";
    } else if (manifest.publish_mode === 'local' && manifest.drive_local_path) {
      msg += "💻 *Local Path:* `" + manifest.drive_local_path + "`\n";
      msg += "ℹ️ *Google Drive Desktop will sync this file to your Drive.*";
    }
  } else if (manifest.status === 'dry_run') {
    msg += "⚠️ *Dry Run (No Upload):* " + manifest.error;
  } else {
    msg += "❌ *Publish Failed:* " + manifest.error;
  }

  return msg;
}

async function handleDrivePublishCampaign(campaignName, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/drive_publish_campaign', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/drive_publish_campaign', permCheck.reason, message);
  }

  if (!campaignName) {
    return "Usage: /drive_publish_campaign <campaign_name>\nExample: /drive_publish_campaign batch-001-founder-demo-ad";
  }

  const base = path.basename(campaignName);
  if (campaignName !== base) {
    return "❌ Access denied: Invalid campaign folder name or path traversal detected.";
  }

  let rootDir = process.env.OPENCLAW_WORKSPACE_ROOT;
  if (!rootDir || !fs.existsSync(path.join(rootDir, 'openclaw'))) {
    rootDir = path.join(__dirname, '../../');
  }

  const campaignsDir = path.join(rootDir, 'campaigns');
  if (!fs.existsSync(campaignsDir)) {
    return "❌ campaigns/ directory not found in workspace.";
  }

  const projects = fs.readdirSync(campaignsDir);
  let campaignPath = null;
  let projectName = 'SeptiVolt';

  for (const proj of projects) {
    const projPath = path.join(campaignsDir, proj);
    if (fs.statSync(projPath).isDirectory()) {
      const candidatePath = path.join(projPath, base);
      if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory()) {
        campaignPath = candidatePath;
        projectName = proj;
        break;
      }
    }
  }

  if (!campaignPath) {
    return "❌ Campaign folder \"" + base + "\" not found under campaigns/.";
  }

  const results = await drivePublisher.publishCampaignToDrive(campaignPath, {
    project: projectName,
    campaign: base
  });

  const succeeded = results.filter(r => r.status === 'published').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const dryRun = results.filter(r => r.status === 'dry_run').length;

  let msg = "📤 *Google Drive Campaign Publish Summary*\n\n";
  msg += "📁 *Campaign:* `" + base + "`\n";
  msg += "✅ *Published:* " + succeeded + " file(s)\n";
  if (failed > 0) msg += "❌ *Failed:* " + failed + " file(s)\n";
  if (dryRun > 0) msg += "⚠️ *Dry Run:* " + dryRun + " file(s)\n";

  const latestPublished = results.find(r => r.status === 'published');
  if (latestPublished) {
    if (latestPublished.publish_mode === 'api' && latestPublished.drive_web_url) {
      msg += "\n🔗 *Drive Link:* " + latestPublished.drive_web_url;
    } else if (latestPublished.publish_mode === 'local' && latestPublished.drive_local_path) {
      msg += "\n💻 *Local Path:* `" + path.dirname(latestPublished.drive_local_path) + "`";
    }
  }

  return msg;
}

// ------------------------------------------
// Core Executions for Gated Commands
// ------------------------------------------

async function executeRunPublish(text, message, approvalId) {
  const startTime = Date.now();
  const { generateRuntimeJobId } = require('../../openclaw/runtime/runtime-job-id');
  const jobId = generateRuntimeJobId();

  const trimmed = text.trim();
  const commandWord = trimmed.split(/\s+/)[0];
  const commandTextWithoutCmd = trimmed.substring(commandWord.length).trim();

  const firstSpaceIdx = commandTextWithoutCmd.search(/\s/);
  let botSlug = '';
  let userRequest = '';
  if (firstSpaceIdx === -1) {
    botSlug = commandTextWithoutCmd;
    userRequest = '';
  } else {
    botSlug = commandTextWithoutCmd.substring(0, firstSpaceIdx).trim();
    userRequest = commandTextWithoutCmd.substring(firstSpaceIdx).trim();
  }

  const senderChatId = message.chat?.id || '';

  let execResult;
  try {
    execResult = await runtimeExecutor.runBot(botSlug, userRequest, senderChatId, jobId);
  } catch (err) {
    try {
      const runtimeLogger = require('../../openclaw/runtime/runtime-logger');
      runtimeLogger.logEvent({
        jobId,
        type: 'runtime_execution',
        command: 'run_publish',
        botSlug: botSlug,
        status: 'failure',
        durationMs: Date.now() - startTime,
        errorCategory: 'internal_error',
        safeMessage: `Runtime execution failed unexpectedly: ${err.message}`
      });
    } catch (logErr) {}
    const { transitionToExecutionFailed } = require('../../openclaw/runtime/runtime-approvals');
    transitionToExecutionFailed(approvalId, `Runtime execution failed unexpectedly: ${err.message}`);
    return `❌ Runtime execution failed unexpectedly. Please try again or contact admin.`;
  }

  if (execResult.status !== 'success') {
    try {
      const runtimeLogger = require('../../openclaw/runtime/runtime-logger');
      runtimeLogger.logEvent({
        jobId,
        type: 'runtime_execution',
        command: 'run_publish',
        botSlug: botSlug,
        status: 'failure',
        durationMs: Date.now() - startTime,
        errorCategory: execResult.status === 'unauthorized' ? 'unauthorized' : 'validation_failed',
        safeMessage: execResult.message
      });
    } catch (logErr) {}
    const { transitionToExecutionFailed } = require('../../openclaw/runtime/runtime-approvals');
    transitionToExecutionFailed(approvalId, execResult.message);
    return execResult.message;
  }

  const generatedFilename = execResult.filename;
  const botName = execResult.botName || botSlug;

  let workspaceRoot = process.env.OPENCLAW_WORKSPACE_ROOT;
  if (!workspaceRoot || !fs.existsSync(path.join(workspaceRoot, 'openclaw'))) {
    workspaceRoot = path.join(__dirname, '../../');
  }
  const responsesDir = path.resolve(workspaceRoot, 'openclaw', 'outbox', 'telegram-responses');
  const exactFilePath = path.resolve(responsesDir, path.basename(generatedFilename));

  let publishResult;
  try {
    publishResult = await drivePublisher.publishExactRuntimeFile(exactFilePath, { bot: botSlug, jobId: jobId });
  } catch (err) {
    try {
      const runtimeLogger = require('../../openclaw/runtime/runtime-logger');
      runtimeLogger.logEvent({
        jobId,
        type: 'runtime_execution',
        command: 'run_publish',
        botSlug: botSlug,
        status: 'failure',
        durationMs: Date.now() - startTime,
        errorCategory: 'google_drive_error',
        safeMessage: `Drive publish failed: ${err.message}`
      });
    } catch (logErr) {}
    const { transitionToExecutionFailed } = require('../../openclaw/runtime/runtime-approvals');
    transitionToExecutionFailed(approvalId, `Drive publish failed: ${err.message}`);
    return [
      `✅ *Bot execution successful!*`,
      `🤖 *Bot:* ${botName}`,
      `📄 *File:* \`${generatedFilename}\``,
      ``,
      `⚠️ *Drive Publish Failed:* An error occurred during publishing.`,
      `To publish manually, run: /drive_publish_pending`
    ].join('\n');
  }

  if (publishResult.status === 'rejected') {
    try {
      const runtimeLogger = require('../../openclaw/runtime/runtime-logger');
      runtimeLogger.logEvent({
        jobId,
        type: 'runtime_execution',
        command: 'run_publish',
        botSlug: botSlug,
        status: 'failure',
        durationMs: Date.now() - startTime,
        errorCategory: 'google_drive_error',
        safeMessage: `Drive publish rejected: ${publishResult.error || 'unknown'}`
      });
    } catch (logErr) {}
    const { transitionToExecutionFailed } = require('../../openclaw/runtime/runtime-approvals');
    transitionToExecutionFailed(approvalId, `Drive publish rejected: ${publishResult.error}`);
    return [
      `✅ *Bot execution successful!*`,
      `🤖 *Bot:* ${botName}`,
      `📄 *File:* \`${generatedFilename}\``,
      ``,
      `⚠️ *Drive Publish Skipped:* ${publishResult.error}`,
      `To publish manually, run: /drive_publish_pending`
    ].join('\n');
  }

  if (publishResult.status === 'already_published') {
    const existingLink = publishResult.drive_web_url || publishResult.drive_local_path || '(local copy — no API link)';
    try {
      const runtimeLogger = require('../../openclaw/runtime/runtime-logger');
      runtimeLogger.logEvent({
        jobId,
        type: 'runtime_execution',
        command: 'run_publish',
        botSlug: botSlug,
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
    } catch (logErr) {}
    const resultMsg = [
      `⚠️ *Already Published — No Duplicate Upload*`,
      ``,
      `🆔 *Job ID:* \`${jobId}\``,
      `🤖 *Bot:* ${botName}`,
      `📄 *File:* \`${generatedFilename}\``,
      `🔗 *Existing Drive Link:* ${existingLink}`,
      ``,
      `Next command: /run_job ${jobId}`
    ].join('\n');

    const { transitionToExecuted } = require('../../openclaw/runtime/runtime-approvals');
    transitionToExecuted(approvalId, jobId, generatedFilename, existingLink, resultMsg);
    return resultMsg;
  }

  if (publishResult.status === 'published') {
    const driveLink = publishResult.drive_web_url || publishResult.drive_local_path || '(local sync — no API link)';
    try {
      const runtimeLogger = require('../../openclaw/runtime/runtime-logger');
      runtimeLogger.logEvent({
        jobId,
        type: 'runtime_execution',
        command: 'run_publish',
        botSlug: botSlug,
        status: 'success',
        filename: generatedFilename,
        published: true,
        publishStatus: 'published',
        driveLink: driveLink,
        durationMs: Date.now() - startTime,
        errorCategory: null,
        safeMessage: null
      });
    } catch (logErr) {}
    const resultMsg = [
      `✅ *Run + Publish Complete!*`,
      ``,
      `🆔 *Job ID:* \`${jobId}\``,
      `🤖 *Bot:* ${botName}`,
      `📄 *File:* \`${generatedFilename}\``,
      `🚦 *Drive Status:* PUBLISHED`,
      `🔗 *Drive Link:* ${driveLink}`,
      ``,
      `*Summary:*`,
      execResult.summary || '(no summary)',
      ``,
      `Next command: /drive_latest`
    ].join('\n');

    const { transitionToExecuted } = require('../../openclaw/runtime/runtime-approvals');
    transitionToExecuted(approvalId, jobId, generatedFilename, driveLink, resultMsg);
    return resultMsg;
  }

  const { transitionToExecutionFailed } = require('../../openclaw/runtime/runtime-approvals');
  transitionToExecutionFailed(approvalId, publishResult.error || 'Unknown error.');
  return [
    `✅ *Bot execution successful!*`,
    `🤖 *Bot:* ${botName}`,
    `📄 *File:* \`${generatedFilename}\``,
    ``,
    `⚠️ *Drive Publish Failed:* ${publishResult.error || 'Unknown error.'}`,
    `To publish manually, run: /drive_publish_pending`
  ].join('\n');
}

async function executeRunPresetPublish(text, message, approvalId) {
  const trimmed = text.trim();
  const commandWord = trimmed.split(/\s+/)[0];
  const commandTextWithoutCmd = trimmed.substring(commandWord.length).trim();

  const firstSpaceIdx = commandTextWithoutCmd.search(/\s/);
  let presetId = '';
  let input = '';
  if (firstSpaceIdx === -1) {
    presetId = commandTextWithoutCmd;
    input = '';
  } else {
    presetId = commandTextWithoutCmd.substring(0, firstSpaceIdx).trim();
    input = commandTextWithoutCmd.substring(firstSpaceIdx).trim();
  }

  const { runPresetPublish } = require('../../openclaw/runtime/runtime-presets');
  const { transitionToExecuted, transitionToExecutionFailed } = require('../../openclaw/runtime/runtime-approvals');
  const senderChatId = message.chat?.id || '';

  try {
    const result = await runPresetPublish(presetId, input, senderChatId);
    if (result.status === 'success') {
      transitionToExecuted(approvalId, result.jobId, result.filename, result.driveLink || null, result.message);
    } else {
      transitionToExecutionFailed(approvalId, result.message || 'Preset execution failed');
    }
    return result.message;
  } catch (err) {
    transitionToExecutionFailed(approvalId, err.message);
    return `❌ Preset execution failed: ${err.message}`;
  }
}

// ------------------------------------------
// Approval Command Handlers
// ------------------------------------------

async function handleApprovalList(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/approval_list', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/approval_list', permCheck.reason, message);
  }

  const { listApprovals } = require('../../openclaw/runtime/runtime-approvals');
  // Load recent approvals, count pending up to 50, but filter to return at most 5 pending
  const list = listApprovals(50);
  const pending = list.filter(a => a.status === 'pending').slice(0, 5);

  if (pending.length === 0) {
    return "No pending approvals found.";
  }

  let msg = "📋 *Pending Approvals (Max 5)*\n\n";
  pending.forEach(a => {
    msg += `• *Approval ID:* \`${a.approvalId}\`\n`;
    msg += `  *Command:* \`${a.command}\`\n`;
    if (a.botSlug) msg += `  *Bot:* \`${a.botSlug}\`\n`;
    if (a.presetId) msg += `  *Preset:* \`${a.presetId}\`\n`;
    msg += `  *Risk Tier:* \`${a.commandTier}\`\n`;
    msg += `  *Created:* ${a.createdAt}\n`;
    msg += `  *Expires:* ${a.expiresAt}\n`;
    msg += `  *Preview:* ${a.inputPreview.substring(0, 100)}\n`;
    msg += `  *To approve:* /approve_run ${a.approvalId}\n\n`;
  });
  return msg.trim();
}

async function handleApprovalInfo(approvalId, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/approval_info', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/approval_info', permCheck.reason, message);
  }

  if (!approvalId || !approvalId.trim()) {
    return "❌ Missing approval ID.\nUsage: /approval_info <approval_id>";
  }

  const { getApproval } = require('../../openclaw/runtime/runtime-approvals');
  const a = getApproval(approvalId.trim());

  if (!a) {
    return "❌ Error: Approval not found or invalid format.";
  }

  let msg = `🎯 *Approval Info: ${a.approvalId}*\n\n`;
  msg += `• *Original Command:* \`${a.command}\`\n`;
  if (a.botSlug) msg += `• *Bot Slug:* \`${a.botSlug}\`\n`;
  if (a.presetId) msg += `• *Preset ID:* \`${a.presetId}\`\n`;
  msg += `• *Risk Tier:* \`${a.commandTier}\`\n`;
  msg += `• *Requested Action:* Execute original parameters\n`;
  msg += `• *Preview:* ${a.inputPreview}\n`;
  msg += `• *Created:* ${a.createdAt}\n`;
  msg += `• *Expires:* ${a.expiresAt}\n`;
  msg += `• *Status:* \`${a.status.toUpperCase()}\`\n\n`;

  if (a.status === 'pending') {
    msg += `*Next commands:*\n`;
    msg += `  /approve_run ${a.approvalId}\n`;
    msg += `  /reject_run ${a.approvalId}`;
  } else {
    if (a.resultJobId) msg += `• *Result Job ID:* \`${a.resultJobId}\`\n`;
    if (a.resultFilename) msg += `• *Result File:* \`${a.resultFilename}\`\n`;
    if (a.driveLink) {
      const sanitizedLink = a.driveLink.replace(/[a-zA-Z]:\\[\\\w\s.-]+/g, 'openclaw/outbox/').replace(/\/[\w\s.-]+\/[\w\s.-]+/g, 'openclaw/outbox/');
      msg += `• *Drive Link:* ${sanitizedLink}\n`;
    }
  }
  return msg;
}

async function handleApproveRun(approvalId, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/approve_run', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/approve_run', permCheck.reason, message);
  }

  if (!approvalId || !approvalId.trim()) {
    return "❌ Error: Missing Approval ID. Usage: /approve_run <approval_id>";
  }

  const { getApproval, transitionToApproved, transitionToExecutionFailed } = require('../../openclaw/runtime/runtime-approvals');
  const record = getApproval(approvalId.trim());
  if (!record) {
    return "❌ Error: Approval not found or invalid format.";
  }

  if (record.status === 'expired') {
    return `❌ Error: Approval is expired (Expires: ${record.expiresAt}). Please recreate the command.`;
  }
  if (record.status !== 'pending') {
    return `❌ Error: Approval is no longer pending (current status: ${record.status}).`;
  }

  const approverChatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const roles = require('../../openclaw/runtime/runtime-roles');
  const approverHash = roles.hashChatIdForLogs(approverChatId);
  const isSuperAdmin = roles.hasRole(approverChatId, 'super_admin');

  if (approverHash === record.requestedByChatIdHash && !isSuperAdmin) {
    const runtimeLogger = require('../../openclaw/runtime/runtime-logger');
    runtimeLogger.logEvent({
      event: 'approval_decision',
      command: 'approve_run',
      approvalId: record.approvalId,
      status: 'failure',
      errorCategory: 'unauthorized',
      selfApprovalDenied: true,
      safeMessage: `Self-approval denied for approval ID: ${record.approvalId}`
    });
    return `❌ Self-Approval Denied: Operators and non-super_admins cannot approve their own gated commands.`;
  }

  // Re-check original command permission against the approver's chat ID
  const isAuthorizedApprover = isSuperAdmin || (roles.getEffectiveCapabilities(approverChatId).has('approve_publish') && record.commandTier === 'publish');

  if (!isAuthorizedApprover) {
    return `❌ Access Denied: You are not authorized to approve commands of tier ${record.commandTier}.`;
  }

  // Transition to approved
  transitionToApproved(record.approvalId);

  // Execute based on command type
  try {
    if (record.command === 'run_publish') {
      return await handleRunPublish(record.safePayload.text, record.safePayload.message, record.approvalId);
    } else if (record.command === 'run_preset_publish') {
      return await handleRunPresetPublish(record.safePayload.text, record.safePayload.message, record.approvalId);
    } else if (record.command === 'drive_republish_latest') {
      return await handleDriveRepublishLatest(record.safePayload.message, record.approvalId);
    } else if (record.command === 'dryrun_publish') {
      return await handleDryRunPublish(record.safePayload.text, record.safePayload.message, record.approvalId);
    } else {
      transitionToExecutionFailed(record.approvalId, `Unknown command type: ${record.command}`);
      return `❌ Error: Unknown approved command type in approval record: ${record.command}`;
    }
  } catch (err) {
    transitionToExecutionFailed(record.approvalId, err.message);
    return `❌ Approval execution failed: ${err.message}`;
  }
}

async function handleRejectRun(approvalId, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/reject_run', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/reject_run', permCheck.reason, message);
  }

  if (!approvalId || !approvalId.trim()) {
    return "❌ Error: Missing Approval ID. Usage: /reject_run <approval_id>";
  }

  const { getApproval, rejectApproval } = require('../../openclaw/runtime/runtime-approvals');
  const record = getApproval(approvalId.trim());
  if (!record) {
    return "❌ Error: Approval not found or invalid format.";
  }

  if (record.status === 'expired') {
    return `❌ Error: Approval is expired (Expires: ${record.expiresAt}).`;
  }
  if (record.status !== 'pending') {
    return `❌ Error: Approval is no longer pending (current status: ${record.status}).`;
  }

  rejectApproval(record.approvalId);
  return `✅ Pending run ${record.approvalId} successfully rejected.`;
}

async function handleApprovalHistory(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/approval_history', message);
  const runtimeLogger = require('../../openclaw/runtime/runtime-logger');

  if (!permCheck.allowed) {
    runtimeLogger.logEvent({
      event: 'approval_history_viewed',
      command: 'approval_history',
      status: 'failure',
      errorCategory: 'unauthorized',
      safeMessage: 'Access Denied: You are not authorized to view approval history.'
    });
    return formatPermissionDenied('/approval_history', permCheck.reason, message);
  }

  const { getApprovalHistory, summarizeApprovalForTelegram } = require('../../openclaw/runtime/runtime-approvals');
  const history = getApprovalHistory(10);

  runtimeLogger.logEvent({
    event: 'approval_history_viewed',
    command: 'approval_history',
    resultCount: history.length
  });

  if (history.length === 0) {
    return "No approval history found.";
  }

  let msg = "📋 *Approval History (Last 10)*\n\n";
  const formatted = history.map(a => summarizeApprovalForTelegram(a));
  msg += formatted.join('\n\n');
  return msg;
}

async function handleApprovalSearch(keyword, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/approval_search', message);
  const runtimeLogger = require('../../openclaw/runtime/runtime-logger');

  if (!permCheck.allowed) {
    runtimeLogger.logEvent({
      event: 'approval_search_performed',
      command: 'approval_search',
      status: 'failure',
      errorCategory: 'unauthorized',
      safeMessage: 'Access Denied: You are not authorized to search approvals.'
    });
    return formatPermissionDenied('/approval_search', permCheck.reason, message);
  }

  if (!keyword || !keyword.trim()) {
    return "❌ Usage: /approval_search <keyword>\nExample: /approval_search content-forge";
  }

  const { searchApprovals, sanitizeApprovalSearchQuery, summarizeApprovalForTelegram } = require('../../openclaw/runtime/runtime-approvals');
  const sanitizedKeyword = sanitizeApprovalSearchQuery(keyword);
  const results = searchApprovals(sanitizedKeyword, 5);

  runtimeLogger.logEvent({
    event: 'approval_search_performed',
    command: 'approval_search',
    resultCount: results.length,
    safeMessage: `Search query: ${sanitizedKeyword}`
  });

  if (results.length === 0) {
    return "No approvals found matching that search.";
  }

  let msg = `🔍 *Approval Search Results for "${sanitizedKeyword}" (Max 5)*\n\n`;
  const formatted = results.map(a => summarizeApprovalForTelegram(a));
  msg += formatted.join('\n\n');
  return msg;
}

async function handleApprovalByStatus(status, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/approval_by_status', message);
  const runtimeLogger = require('../../openclaw/runtime/runtime-logger');

  if (!permCheck.allowed) {
    runtimeLogger.logEvent({
      event: 'approval_status_filtered',
      command: 'approval_by_status',
      status: 'failure',
      errorCategory: 'unauthorized',
      safeMessage: 'Access Denied: You are not authorized to view approvals by status.'
    });
    return formatPermissionDenied('/approval_by_status', permCheck.reason, message);
  }

  if (!status || !status.trim()) {
    return "❌ Usage: /approval_by_status <status>\nExample: /approval_by_status pending";
  }

  const cleanStatus = status.trim().toLowerCase();
  const allowed = ['pending', 'approved', 'rejected', 'expired', 'executed', 'failed'];
  if (!allowed.includes(cleanStatus)) {
    return `❌ Invalid status: '${status}'. Allowed statuses are: pending, approved, rejected, expired, executed, failed.`;
  }

  const { getApprovalsByStatus, summarizeApprovalForTelegram } = require('../../openclaw/runtime/runtime-approvals');
  const results = getApprovalsByStatus(cleanStatus, 10);

  runtimeLogger.logEvent({
    event: 'approval_status_filtered',
    command: 'approval_by_status',
    resultCount: results.length,
    statusFilter: cleanStatus
  });

  if (results.length === 0) {
    return `No approvals found with status '${cleanStatus}'.`;
  }

  let msg = `📋 *Approvals by Status: ${cleanStatus.toUpperCase()} (Max 10)*\n\n`;
  const formatted = results.map(a => summarizeApprovalForTelegram(a));
  msg += formatted.join('\n\n');
  return msg;
}

async function handleApprovalCleanupExpired(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/approval_cleanup_expired', message);
  const runtimeLogger = require('../../openclaw/runtime/runtime-logger');

  if (!permCheck.allowed) {
    runtimeLogger.logEvent({
      event: 'approval_cleanup_expired',
      command: 'approval_cleanup_expired',
      status: 'failure',
      errorCategory: 'unauthorized',
      safeMessage: 'Access Denied: You are not authorized to clean up expired approvals.'
    });
    return formatPermissionDenied('/approval_cleanup_expired', permCheck.reason, message);
  }

  const { cleanupExpiredApprovals } = require('../../openclaw/runtime/runtime-approvals');
  const count = cleanupExpiredApprovals();

  runtimeLogger.logEvent({
    event: 'approval_cleanup_expired',
    command: 'approval_cleanup_expired',
    resultCount: count
  });

  return [
    `Expired approvals updated: ${count}`,
    `Next command:`,
    ` /approval_by_status expired`
  ].join('\n');
}

// ------------------------------------------
// ------------------------------------------
// Prospect Command Handlers
// ------------------------------------------

async function handleProspectStatus(message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/prospect_status', chatId);
  }

  const enabled = process.env.GOOGLE_PLACES_PROSPECTING_ENABLED === 'true';
  const sourceMode = enabled ? 'google_places' : 'mock';
  const limit = process.env.GOOGLE_PLACES_DAILY_QUERY_LIMIT || '25';
  const maxResults = process.env.GOOGLE_PLACES_MAX_RESULTS_PER_QUERY || '10';
  const fieldProfile = process.env.GOOGLE_PLACES_FIELD_PROFILE || 'BASIC_DISCOVERY';

  const intake = require('../../openclaw/prospects/google-places-prospect-intake');
  const dailyCount = intake.getDailyQueryCount();

  const store = require('../../openclaw/prospects/prospect-store');
  const totalProspects = store.loadProspects().length;

  return [
    `🔍 *Prospect Intake Status*`,
    ``,
    `• *Prospecting Enabled:* \`${enabled}\``,
    `• *Source Mode:* \`${sourceMode}\``,
    `• *Daily Query Limit:* \`${limit}\``,
    `• *Daily Query Count:* \`${dailyCount}/${limit}\``,
    `• *Max Results Per Query:* \`${maxResults}\``,
    `• *Field Profile:* \`${fieldProfile}\``,
    `• *Total Saved Prospects:* \`${totalProspects}\``,
    `• *Real Execution Enabled:* \`false\``
  ].join('\n');
}

async function handleProspectSearch(query, message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/prospect_search', chatId);
  }

  if (!query || !query.trim()) {
    return `Usage: /prospect_search <query>`;
  }

  const cleanQuery = query.trim();
  const intake = require('../../openclaw/prospects/google-places-prospect-intake');
  const store = require('../../openclaw/prospects/prospect-store');

  try {
    const prospectsBefore = store.loadProspects().length;
    const results = await intake.searchLocalProspects(cleanQuery);
    const prospectsAfter = store.loadProspects().length;

    const found = results.length;
    const added = prospectsAfter - prospectsBefore;
    const duplicates = found - added;

    const limit = parseInt(process.env.GOOGLE_PLACES_DAILY_QUERY_LIMIT || '25', 10);
    const dailyCount = intake.getDailyQueryCount();
    const remaining = Math.max(0, limit - dailyCount);
    const fieldProfile = process.env.GOOGLE_PLACES_FIELD_PROFILE || 'BASIC_DISCOVERY';

    return [
      `✅ *Prospect Search Completed*`,
      ``,
      `• *Query:* \`${cleanQuery}\``,
      `• *Found:* \`${found}\``,
      `• *Added:* \`${added}\``,
      `• *Duplicates Skipped:* \`${duplicates}\``,
      `• *Field Profile Used:* \`${fieldProfile}\``,
      `• *Daily Quota Remaining:* \`${remaining}/${limit}\``
    ].join('\n');
  } catch (err) {
    return `❌ *Prospect Search Failed*:\n${err.message}`;
  }
}

async function handleProspectLatest(message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/prospect_latest', chatId);
  }

  const store = require('../../openclaw/prospects/prospect-store');
  const prospects = store.loadProspects();

  if (prospects.length === 0) {
    return `ℹ️ No saved prospects found. Run /prospect_search to discover some.`;
  }

  const sorted = [...prospects].sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt));
  const latest = sorted.slice(0, 5);

  let output = `📋 *Latest Discovered Prospects (Dry-Run Only)*\n\n`;
  latest.forEach((p, idx) => {
    output += `${idx + 1}. *${p.businessName || p.name || 'Unknown Business'}*\n`;
    output += `   • ID: \`${p.prospectId}\`\n`;
    output += `   • Address: ${p.formattedAddress}\n`;
    if (p.phoneNumber) output += `   • Phone: ${p.phoneNumber}\n`;
    if (p.website) output += `   • Website: ${p.website}\n`;
    output += `   • Discovered: ${new Date(p.discoveredAt).toLocaleString()}\n\n`;
  });

  const buttons = [];
  const row = [];
  latest.forEach((p, idx) => {
    row.push({ text: `${idx + 1}️⃣`, callback_data: `act:prop_read:${p.prospectId}` });
  });
  if (row.length > 0) buttons.push(row);
  const baseDash = getPublicBaseUrl();
  buttons.push([{ text: "🖥 Open Dashboard", url: `${baseDash}/dashboard/prospects` }]);
  const response = new String(output.trim());
  response.reply_markup = { inline_keyboard: buttons };
  return response;
}

async function handleProspectList(message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/prospect_list', chatId);
  }

  const store = require('../../openclaw/prospects/prospect-store');
  const prospects = store.loadProspects();

  if (prospects.length === 0) {
    return `ℹ️ No saved prospects found. Run /prospect_search to discover some.`;
  }

  const sorted = [...prospects].sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt));
  const recent = sorted.slice(0, 10);

  let output = `📋 *Recent Discovered Prospects*\n\n`;
  recent.forEach((p, idx) => {
    output += `${idx + 1}. *${p.businessName || p.name || 'Unknown Business'}*\n`;
    output += `   • ID: \`${p.prospectId}\`\n`;
    output += `   • Town/Region: ${p.town}, ${p.region}\n`;
    output += `   • Category: \`${p.category}\`\n`;
    output += `   • Source: \`${p.source}\` | Profile: \`${p.fieldProfile}\`\n\n`;
  });

  return output.trim();
}

async function handleProspectRead(prospectId, message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/prospect_read', chatId);
  }

  if (!prospectId || !prospectId.trim()) {
    return `Usage: /prospect_read <prospectId>`;
  }

  const cleanId = prospectId.trim();
  const store = require('../../openclaw/prospects/prospect-store');
  const prospects = store.loadProspects();
  const prospect = prospects.find(p => p.prospectId === cleanId);

  if (!prospect) {
    return `❌ Error: Prospect with ID \`${cleanId}\` not found.`;
  }

  const formatters = require('./hermes-card-formatters');
  return formatters.formatProspectCard(prospect);
}

async function handleProspectOutreach(prospectId, message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('generate_runtime')) {
    return roles.formatRoleDenied('/prospect_outreach', chatId);
  }

  if (!prospectId || !prospectId.trim()) {
    return `Usage: /prospect_outreach <prospectId>`;
  }

  const cleanId = prospectId.trim();
  const store = require('../../openclaw/prospects/prospect-store');
  
  try {
    const researchStore = require('../../openclaw/research/prospect-research-store');
    const hasResearch = !!researchStore.getResearchForProspect(cleanId);

    const result = store.createHermesOutreachJobFromProspects([cleanId], {
      requestedBy: chatId,
      source: 'telegram',
      botId: 'content-forge'
    });
    
    const jobId = result.jobs[0].hermesJobId;
    return [
      `✅ *Hermes Outreach Job Queued*`,
      ``,
      `• *Prospect ID:* \`${cleanId}\``,
      `• *Hermes Job ID:* \`${jobId}\``,
      `• *Research Context:* ${hasResearch ? '✅ Included (Research-informed outreach)' : '❌ None (Basic prospect-only)'}`,
      `• *Status:* \`queued\``,
      ``,
      `Next commands:`,
      `• Read job: \`/hermes_read ${jobId}\``,
      `• Dispatch manually: \`/hermes_dispatch ${jobId}\``,
      `• Trace lifecycle: \`/hermes_trace ${jobId}\``
    ].join('\n');
  } catch (err) {
    return `❌ *Outreach Handoff Failed*:\n${err.message}`;
  }
}

async function handleProspectOutreachBatch(args, message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('generate_runtime')) {
    return roles.formatRoleDenied('/prospect_outreach_batch', chatId);
  }

  if (!args || !args.trim()) {
    return `Usage: /prospect_outreach_batch <prospectId1,prospectId2,...>`;
  }

  const prospectIds = args.split(',').map(s => s.trim()).filter(Boolean);
  if (prospectIds.length === 0) {
    return `❌ Error: No valid prospect IDs provided.`;
  }

  const store = require('../../openclaw/prospects/prospect-store');
  try {
    const result = store.createHermesOutreachJobFromProspects(prospectIds, {
      requestedBy: chatId,
      source: 'telegram',
      botId: 'content-forge'
    });

    const researchStore = require('../../openclaw/research/prospect-research-store');
    let out = `✅ *Hermes Batch Outreach Jobs Queued*\n\n`;
    out += `• *Total Prospects Handed Off:* \`${result.jobs.length}\`\n\n`;
    result.jobs.forEach((job, idx) => {
      const pId = job.metadata.prospectId;
      const hasResearch = !!researchStore.getResearchForProspect(pId);
      out += `${idx + 1}. *${job.metadata.businessName || 'Unknown'}*\n` +
             `   • Prospect ID: \`${pId}\`\n` +
             `   • Research Context: ${hasResearch ? '✅ Included' : '❌ None'}\n` +
             `   • Hermes Job ID: \`/hermes_read ${job.hermesJobId}\`\n` +
             `   • Dispatch: \`/hermes_dispatch ${job.hermesJobId}\`\n\n`;
    });
    return out.trim();
  } catch (err) {
    return `❌ *Batch Handoff Failed*:\n${err.message}`;
  }
}

async function handleOutreachStatus(message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/outreach_status', chatId);
  }

  const store = require('../../openclaw/prospects/prospect-outreach-review-store');
  try {
    const list = store.syncReviews();
    const counts = {
      not_started: 0,
      draft_generated: 0,
      reviewed: 0,
      contacted_manually: 0,
      follow_up_needed: 0,
      not_interested: 0,
      booked_call: 0
    };

    for (const item of list) {
      if (item.status in counts) {
        counts[item.status]++;
      }
    }

    return [
      `📊 *Outreach Review Workspace Status*`,
      ``,
      `• *Not Started:* \`${counts.not_started}\``,
      `• *Draft Generated:* \`${counts.draft_generated}\``,
      `• *Reviewed:* \`${counts.reviewed}\``,
      `• *Contacted Manually:* \`${counts.contacted_manually}\``,
      `• *Follow-up Needed:* \`${counts.follow_up_needed}\``,
      `• *Not Interested:* \`${counts.not_interested}\``,
      `• *Booked Call:* \`${counts.booked_call}\``,
      ``,
      `Use \`/outreach_list\` to list review records.`
    ].join('\n');
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleOutreachList(message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/outreach_list', chatId);
  }

  const store = require('../../openclaw/prospects/prospect-outreach-review-store');
  try {
    const list = store.syncReviews();
    if (list.length === 0) {
      return `ℹ️ No outreach review records found.`;
    }

    const sorted = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const recent = sorted.slice(0, 10);

    let output = `📋 *Recent Outreach Review Records*\n\n`;
    recent.forEach((r, idx) => {
      output += `${idx + 1}. *${r.businessName}*\n`;
      output += `   • Review ID: \`${r.reviewId}\`\n`;
      output += `   • Status: \`${r.status}\`\n`;
      if (r.hermesJobId) output += `   • Hermes Job ID: \`${r.hermesJobId}\`\n`;
      output += `\n`;
    });

    return output.trim();
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleOutreachRead(idOrPid, message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/outreach_read', chatId);
  }

  if (!idOrPid || !idOrPid.trim()) {
    return `Usage: /outreach_read <reviewId or prospectId>`;
  }

  const targetId = idOrPid.trim();
  const store = require('../../openclaw/prospects/prospect-outreach-review-store');
  try {
    const list = store.syncReviews();
    const record = list.find(r => r.reviewId === targetId || r.prospectId === targetId);

    if (!record) {
      return `❌ Error: Outreach review record not found for '${targetId}'.`;
    }

    const formatters = require('./hermes-card-formatters');
    return formatters.formatOutreachCard(record, false);
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleOutreachMark(args, message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('generate_runtime')) {
    return roles.formatRoleDenied('/outreach_mark', chatId);
  }

  if (!args || !args.trim()) {
    return `Usage: /outreach_mark <reviewId> <status>`;
  }

  const parts = args.trim().split(/\s+/);
  const reviewId = parts[0];
  const status = parts[1];

  if (!reviewId || !status) {
    return `Usage: /outreach_mark <reviewId> <status>`;
  }

  const store = require('../../openclaw/prospects/prospect-outreach-review-store');
  try {
    const updated = store.updateReviewStatus(reviewId, status);
    return `✅ *Outreach Status Updated*\n\n• *Business:* ${updated.businessName}\n• *Review ID:* \`${updated.reviewId}\`\n• *New Status:* \`${updated.status}\``;
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleOutreachNote(args, message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('generate_runtime')) {
    return roles.formatRoleDenied('/outreach_note', chatId);
  }

  if (!args || !args.trim()) {
    return `Usage: /outreach_note <reviewId> <note>`;
  }

  const parts = args.trim().split(/\s+/);
  const reviewId = parts[0];
  const note = parts.slice(1).join(' ');

  if (!reviewId || !note) {
    return `Usage: /outreach_note <reviewId> <note>`;
  }

  const store = require('../../openclaw/prospects/prospect-outreach-review-store');
  try {
    const updated = store.updateReviewNotes(reviewId, note);
    return `✅ *Outreach Operator Notes Saved*\n\n• *Business:* ${updated.businessName}\n• *Review ID:* \`${updated.reviewId}\`\n• *Notes:* _${updated.operatorNotes}_`;
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleOutreachToday(message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/outreach_today', chatId);
  }

  const store = require('../../openclaw/prospects/prospect-outreach-review-store');
  try {
    const list = store.syncReviews();
    const todayStr = new Date().toISOString().split('T')[0];
    const filtered = list.filter(r => r.nextFollowUpAt && r.nextFollowUpAt.substring(0, 10) <= todayStr && r.status !== 'booked_call' && r.status !== 'not_interested');

    if (filtered.length === 0) {
      return `🎉 No manual outreach follow-ups due today!`;
    }

    let out = `📅 *Outreach Follow-ups Due Today/Overdue*\n\n`;
    filtered.forEach((r, idx) => {
      out += `${idx + 1}. *${r.businessName}*\n` +
             `   • Review ID: \`${r.reviewId}\`\n` +
             `   • Status: \`${r.status}\`\n` +
             `   • Next Follow-up: *${r.nextFollowUpAt}*\n` +
             `   • Contacts: \`${r.manualContactCount || 0}\` (Channel: \`${r.lastManualContactChannel || 'None'}\`)\n\n`;
    });
    return out.trim();
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleOutreachDue(message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/outreach_due', chatId);
  }

  const store = require('../../openclaw/prospects/prospect-outreach-review-store');
  try {
    const list = store.syncReviews();
    const filtered = list.filter(r => r.nextFollowUpAt).sort((a, b) => a.nextFollowUpAt.localeCompare(b.nextFollowUpAt));

    if (filtered.length === 0) {
      return `ℹ️ No manual outreach follow-ups scheduled.`;
    }

    let out = `⏳ *All Scheduled Outreach Follow-ups*\n\n`;
    filtered.forEach((r, idx) => {
      out += `${idx + 1}. *${r.businessName}*\n` +
             `   • Review ID: \`${r.reviewId}\`\n` +
             `   • Status: \`${r.status}\`\n` +
             `   • Next Follow-up: *${r.nextFollowUpAt}*\n` +
             `   • Stage: \`Stage ${r.followUpStage || 0}\`\n\n`;
    });

    const buttons = [];
    const row = [];
    filtered.slice(0, 5).forEach((item, idx) => {
      row.push({ text: `${idx + 1}️⃣`, callback_data: `act:out_read:${item.reviewId}` });
    });
    if (row.length > 0) buttons.push(row);
    const baseDash = getPublicBaseUrl();
    buttons.push([{ text: "🖥 Open Dashboard", url: `${baseDash}/dashboard/outreach` }]);
    const response = new String(out.trim());
    response.reply_markup = { inline_keyboard: buttons };
    return response;
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleOutreachPipeline(message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/outreach_pipeline', chatId);
  }

  const store = require('../../openclaw/prospects/prospect-outreach-review-store');
  try {
    const stats = store.getPipelineAnalytics();
    return [
      `📊 *Outreach Pipeline Summary*`,
      ``,
      `• *Total Reviews:* \`${stats.total}\``,
      `• *Not Started:* \`${stats.not_started}\``,
      `• *Draft Generated:* \`${stats.draft_generated}\``,
      `• *Reviewed:* \`${stats.reviewed}\``,
      `• *Contacted Manually:* \`${stats.contacted_manually}\``,
      `• *Follow-up Needed:* \`${stats.follow_up_needed}\``,
      `• *Booked Call:* \`${stats.booked_call}\``,
      `• *Not Interested:* \`${stats.not_interested}\``,
      `• *Due Today/Overdue:* \`${stats.due_today}\``,
      ``,
      `Use \`/outreach_today\` to list work for today.`
    ].join('\n');
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleOutreachMarkContacted(args, message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('generate_runtime')) {
    return roles.formatRoleDenied('/outreach_mark_contacted', chatId);
  }

  if (!args || !args.trim()) {
    return `Usage: /outreach_mark_contacted <reviewId> <channel>`;
  }

  const parts = args.trim().split(/\s+/);
  const reviewId = parts[0];
  const channel = parts[1];

  if (!reviewId || !channel) {
    return `Usage: /outreach_mark_contacted <reviewId> <channel>`;
  }

  const store = require('../../openclaw/prospects/prospect-outreach-review-store');
  try {
    const updated = store.markReviewContacted(reviewId, channel);
    return `✅ *Manual Contact Logged*\n\n` +
           `• *Business:* ${updated.businessName}\n` +
           `• *Review ID:* \`${updated.reviewId}\`\n` +
           `• *Channel:* \`${updated.lastManualContactChannel}\`\n` +
           `• *Total Contacts:* \`${updated.manualContactCount}\`\n` +
           `• *Status:* \`${updated.status}\``;
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleOutreachFollowUp(args, message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('generate_runtime')) {
    return roles.formatRoleDenied('/outreach_followup', chatId);
  }

  if (!args || !args.trim()) {
    return `Usage: /outreach_followup <reviewId> <YYYY-MM-DD>`;
  }

  const parts = args.trim().split(/\s+/);
  const reviewId = parts[0];
  const nextFollowUpAt = parts[1];

  if (!reviewId || !nextFollowUpAt) {
    return `Usage: /outreach_followup <reviewId> <YYYY-MM-DD>`;
  }

  const store = require('../../openclaw/prospects/prospect-outreach-review-store');
  try {
    const updated = store.setReviewFollowUp(reviewId, nextFollowUpAt);
    return `✅ *Follow-up Scheduled*\n\n` +
           `• *Business:* ${updated.businessName}\n` +
           `• *Review ID:* \`${updated.reviewId}\`\n` +
           `• *Next Follow-up:* *${updated.nextFollowUpAt}*\n` +
           `• *Follow-up Stage:* \`Stage ${updated.followUpStage}\`\n` +
           `• *Status:* \`${updated.status}\``;
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleResearchProspect(prospectId, message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('generate_runtime')) {
    return roles.formatRoleDenied('/research_prospect', chatId);
  }

  if (!prospectId || !prospectId.trim()) {
    return `Usage: /research_prospect <prospectId>`;
  }

  const router = require('../../openclaw/research/research-source-router');
  try {
    const result = await router.enrichProspect(prospectId.trim());
    return `🔬 *Prospect Research Enrichment Complete*\n\n` +
           `• *Business Name:* ${result.businessName}\n` +
           `• *Research ID:* \`${result.researchId}\`\n` +
           `• *Source:* ${result.sourceType} (${result.website})\n` +
           `• *Confidence:* \`${result.confidence * 100}%\`\n\n` +
           `*Website Summary:*\n` +
           `_${result.websiteSummary}_\n\n` +
           `*Services Detected:*\n` +
           `${result.servicesDetected.map(s => `• ${s}`).join('\n')}\n\n` +
           `*Lead Capture Issues:*\n` +
           `${result.leadCaptureIssues.map(s => `• ${s}`).join('\n')}\n\n` +
           `*Recommended Outreach Pitch Angle:*\n` +
           `*${result.recommendedOutreachAngle}*`;
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleResearchRead(idOrPid, message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/research_read', chatId);
  }

  if (!idOrPid || !idOrPid.trim()) {
    return `Usage: /research_read <researchId or prospectId>`;
  }

  const store = require('../../openclaw/research/prospect-research-store');
  const cleanId = idOrPid.trim();
  
  let record = store.getResearchRecord(cleanId);
  if (!record) {
    record = store.getResearchForProspect(cleanId);
  }

  if (!record) {
    return `❌ No research findings found for ID: ${cleanId}`;
  }

  const formatters = require('./hermes-card-formatters');
  return formatters.formatResearchCard(record, false);
}

async function handleResearchLatest(message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/research_latest', chatId);
  }

  const store = require('../../openclaw/research/prospect-research-store');
  const list = store.getLatestResearch(5);

  if (list.length === 0) {
    return `🔬 No research records found. Run /research_prospect <prospectId> to start enrichment.`;
  }

  let out = `🔬 *Latest Research Records*\n\n`;
  list.forEach((r, idx) => {
    out += `${idx + 1}. *${r.businessName}*\n` +
           `   • Research ID: \`${r.researchId}\`\n` +
           `   • Prospect ID: \`${r.prospectId}\`\n` +
           `   • Source: ${r.sourceType} (${r.website})\n\n`;
  });

  return out.trim();
}

async function handleResearchStatus(message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/research_status', chatId);
  }

  const router = require('../../openclaw/research/research-source-router');
  const store = require('../../openclaw/research/prospect-research-store');
  const totalRecords = Object.keys(store.loadResearch()).length;

  const adapterStatus = Object.entries(router.ADAPTER_REGISTRY).map(([type, adapter]) => {
    return `• *${type}:* ${adapter ? '✅ Active' : '❌ Disabled (Stub)'}`;
  });

  return `🔬 *Research Adapter Registry Status*\n\n` +
         `• *Total Research Records:* \`${totalRecords}\`\n\n` +
         `*Adapters Status:*\n` +
         adapterStatus.join('\n');
}

async function handleScoreProspect(prospectId, message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('generate_runtime')) {
    return roles.formatRoleDenied('/score_prospect', chatId);
  }

  if (!prospectId || !prospectId.trim()) {
    return `Usage: /score_prospect <prospectId>`;
  }

  const optimizer = require('../../openclaw/research/prospect-angle-optimizer');
  try {
    const result = optimizer.optimizeProspect(prospectId.trim());
    return `🎯 *Prospect Evaluation & Scoring Complete*\n\n` +
           `• *Business Name:* ${result.businessName}\n` +
           `• *Score ID:* \`${result.scoreId}\`\n` +
           `• *Priority:* *${result.priority.toUpperCase()}*\n\n` +
           `*Scores:*\n` +
           `• Fit Score: \`${result.fitScore}/100\`\n` +
           `• Urgency: \`${result.urgencyScore}/100\`\n` +
           `• Website Gaps: \`${result.websiteGapScore}/100\`\n` +
           `• Follow-Up Potential: \`${result.followUpPotentialScore}/100\`\n\n` +
           `• *Recommended Channel:* \`${result.recommendedChannel.toUpperCase()}\`\n` +
           `• *Recommended Offer Angle:* _${result.recommendedOfferAngle}_\n\n` +
           `*Reasoning:*\n` +
           `_${result.reasoning}_\n\n` +
           `*Red Flags / Warnings:* ${result.redFlags.length > 0 ? result.redFlags.map(rf => `\n- ${rf}`).join('') : 'None'}`;
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleScoreRead(idOrPid, message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/score_read', chatId);
  }

  if (!idOrPid || !idOrPid.trim()) {
    return `Usage: /score_read <scoreId or prospectId>`;
  }

  const scoreStore = require('../../openclaw/research/prospect-score-store');
  const cleanId = idOrPid.trim();

  let record = scoreStore.getScoreRecord(cleanId);
  if (!record) {
    record = scoreStore.getScoreForProspect(cleanId);
  }

  if (!record) {
    return `❌ No score record found for ID: ${cleanId}`;
  }

  const formatters = require('./hermes-card-formatters');
  return formatters.formatScoreCard(record, false);
}

async function handleScoreLatest(message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/score_latest', chatId);
  }

  const scoreStore = require('../../openclaw/research/prospect-score-store');
  const list = scoreStore.getLatestScores(5);

  if (list.length === 0) {
    return `🎯 No score records found. Run /score_prospect <prospectId> to start evaluation.`;
  }

  let out = `🎯 *Latest Prospect Scores*\n\n`;
  list.forEach((s, idx) => {
    out += `${idx + 1}. *${s.businessName}*\n` +
           `   • Score: \`${s.fitScore}/100\` | Priority: *${s.priority.toUpperCase()}*\n` +
           `   • Channel: \`${s.recommendedChannel.toUpperCase()}\`\n` +
           `   • Score ID: \`${s.scoreId}\`\n\n`;
  });

  return out.trim();
}

async function handleScoreTop(message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/score_top', chatId);
  }

  const scoreStore = require('../../openclaw/research/prospect-score-store');
  const list = scoreStore.getTopScores(5);

  if (list.length === 0) {
    return `🎯 No score records found. Run /score_prospect <prospectId> to start evaluation.`;
  }

  let out = `🎯 *Top Ranked Prospect Scores*\n\n`;
  list.forEach((s, idx) => {
    out += `${idx + 1}. *${s.businessName}*\n` +
           `   • Score: \`${s.fitScore}/100\` | Priority: *${s.priority.toUpperCase()}*\n` +
           `   • Channel: \`${s.recommendedChannel.toUpperCase()}\`\n` +
           `   • Score ID: \`${s.scoreId}\`\n\n`;
  });

  return out.trim();
}

// Hermes Command Handlers
// ------------------------------------------

async function handleHermesStatus(message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/hermes_status', chatId);
  }

  const formatters = require('../../openclaw/hermes/hermes-telegram-formatters');
  return formatters.formatHermesStatus();
}

async function handleHermesQueue(filterArg, message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/hermes_queue', chatId);
  }

  const formatters = require('../../openclaw/hermes/hermes-telegram-formatters');
  return formatters.formatHermesQueue(filterArg);
}

async function handleHermesLatest(message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/hermes_latest', chatId);
  }

  const formatters = require('../../openclaw/hermes/hermes-telegram-formatters');
  return formatters.formatHermesLatest();
}

async function handleHermesRead(jobId, message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/hermes_read', chatId);
  }

  const formatters = require('../../openclaw/hermes/hermes-telegram-formatters');
  return formatters.formatHermesRead(jobId);
}

async function handleHermesCancel(jobId, reason, message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  
  const isAuthorized = roles.hasRole(chatId, 'super_admin') ||
                       roles.hasRole(chatId, 'operator') ||
                       roles.hasRole(chatId, 'publisher') ||
                       roles.hasRole(chatId, 'approver');
  if (!isAuthorized) {
    return roles.formatRoleDenied('/hermes_cancel', chatId);
  }

  if (!jobId || !jobId.trim()) {
    return `Usage: /hermes_cancel <hermesJobId> [reason]`;
  }

  const cleanId = jobId.trim();
  const engine = require('../../openclaw/hermes/hermes-queue-engine');
  const job = engine.readHermesJob(cleanId);
  if (!job) {
    return `❌ Error: Job \`${cleanId}\` not found in queue.`;
  }

  if (job.status === 'completed') {
    return `❌ Rejection: Cannot cancel job \`${cleanId}\` because it is already COMPLETED.`;
  }
  if (job.status === 'failed') {
    return `❌ Rejection: Cannot cancel job \`${cleanId}\` because it has already FAILED.`;
  }
  if (job.status === 'canceled') {
    return `⚠️ Job \`${cleanId}\` is already canceled.`;
  }

  const cancelReason = reason ? reason.trim() : 'Operator canceled execution via Telegram';
  try {
    const updated = engine.cancelHermesJob(cleanId, cancelReason);
    return `✅ Job \`${cleanId}\` successfully canceled.\nStatus: \`${updated.status.toUpperCase()}\`\nReason: ${cancelReason}`;
  } catch (err) {
    return `❌ Error canceling job: ${err.message}`;
  }
}

async function handleHermesRetry(jobId, message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  
  const isAuthorized = roles.hasRole(chatId, 'super_admin') ||
                       roles.hasRole(chatId, 'operator') ||
                       roles.hasRole(chatId, 'publisher') ||
                       roles.hasRole(chatId, 'approver');
  if (!isAuthorized) {
    return roles.formatRoleDenied('/hermes_retry', chatId);
  }

  if (!jobId || !jobId.trim()) {
    return `Usage: /hermes_retry <hermesJobId>`;
  }

  const cleanId = jobId.trim();
  const engine = require('../../openclaw/hermes/hermes-queue-engine');
  const adapter = require('../../openclaw/hermes/runtime-dispatcher-adapter');

  const job = engine.readHermesJob(cleanId);
  if (!job) {
    return `❌ Error: Job \`${cleanId}\` not found in queue.`;
  }

  if (job.status !== 'failed' && job.status !== 'blocked') {
    return `❌ Rejection: Can only retry FAILED or BLOCKED jobs. Current status: \`${job.status.toUpperCase()}\``;
  }

  try {
    const newJob = engine.createHermesJob({
      requestedBy: job.requestedBy,
      botId: job.botId,
      inputSummary: job.inputSummary,
      priority: job.priority || 'normal',
      metadata: {
        ...(job.metadata || {}),
        originalHermesJobId: job.hermesJobId
      }
    });

    const result = await adapter.dispatchHermesJobToRuntime(newJob.hermesJobId);
    
    let reply = `🔄 *Retry Initiated successfully!*\n\n`;
    reply += `• *Original Job ID:* \`${job.hermesJobId}\`\n`;
    reply += `• *New Job ID:* \`${newJob.hermesJobId}\`\n`;
    reply += `• *Dispatch Status:* \`${result.status.toUpperCase()}\`\n`;
    if (result.approvalId) reply += `• *Approval ID:* \`${result.approvalId}\`\n`;
    if (result.outputPath) reply += `• *Output Path:* \`${result.outputPath}\`\n`;
    if (result.driveLink) reply += `• *Drive Link:* ${result.driveLink}\n`;
    if (result.safeMessage) reply += `• *Message:* ${result.safeMessage}\n`;

    return reply;
  } catch (err) {
    return `❌ Retry failed: ${err.message}`;
  }
}

async function handleHermesDispatch(jobId, message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  
  const isAuthorized = roles.hasRole(chatId, 'super_admin') ||
                       roles.hasRole(chatId, 'operator') ||
                       roles.hasRole(chatId, 'publisher') ||
                       roles.hasRole(chatId, 'approver');
  if (!isAuthorized) {
    return roles.formatRoleDenied('/hermes_dispatch', chatId);
  }

  if (!jobId || !jobId.trim()) {
    return `Usage: /hermes_dispatch <hermesJobId>`;
  }

  const cleanId = jobId.trim();
  const engine = require('../../openclaw/hermes/hermes-queue-engine');
  const adapter = require('../../openclaw/hermes/runtime-dispatcher-adapter');

  const job = engine.readHermesJob(cleanId);
  if (!job) {
    return `❌ Error: Job \`${cleanId}\` not found in queue.`;
  }

  if (job.status !== 'queued' && job.status !== 'approved') {
    return `❌ Rejection: Can only dispatch QUEUED or APPROVED jobs. Current status: \`${job.status.toUpperCase()}\``;
  }

  try {
    const result = await adapter.dispatchHermesJobToRuntime(cleanId);
    
    let reply = `🚀 *Manual Dispatch Executed!*\n\n`;
    reply += `• *Job ID:* \`${cleanId}\`\n`;
    reply += `• *Outcome Status:* \`${result.status.toUpperCase()}\`\n`;
    if (result.approvalId) reply += `• *Approval ID:* \`${result.approvalId}\`\n`;
    if (result.outputPath) reply += `• *Output Path:* \`${result.outputPath}\`\n`;
    if (result.driveLink) reply += `• *Drive Link:* ${result.driveLink}\n`;
    if (result.safeMessage) reply += `• *Message:* ${result.safeMessage}\n`;

    return reply;
  } catch (err) {
    return `❌ Dispatch failed: ${err.message}`;
  }
}

async function handleHermesApproval(message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/hermes_approval', chatId);
  }

  const formatters = require('../../openclaw/hermes/hermes-telegram-formatters');
  return formatters.formatHermesApproval();
}

async function handleHermesApprove(approvalId, message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';

  const isAuthorized = roles.hasRole(chatId, 'super_admin') ||
                       roles.hasRole(chatId, 'approver');
  if (!isAuthorized) {
    return roles.formatRoleDenied('/hermes_approve', chatId);
  }

  if (!approvalId || !approvalId.trim()) {
    return `Usage: /hermes_approve <approvalId>`;
  }

  const cleanApprovalId = approvalId.trim();
  const engine = require('../../openclaw/hermes/hermes-queue-engine');
  const store = require('../../openclaw/hermes/hermes-queue-store');
  const { getApproval } = require('../../openclaw/runtime/runtime-approvals');

  // Find linked Hermes job
  const queue = store.loadQueue();
  const job = Object.values(queue).find(j => j.approvalId === cleanApprovalId);

  // Call existing Runtime approval mechanism
  const resultText = await handleApproveRun(cleanApprovalId, message);

  // If there was a linked Hermes job, update it based on the approval outcome
  if (job) {
    const record = getApproval(cleanApprovalId);
    if (record) {
      if (record.status === 'executed') {
        engine.completeHermesJob(job.hermesJobId, {
          outputPath: record.resultFilename,
          driveLink: record.driveLink,
          runtimeJobId: record.resultJobId
        });
      } else if (record.status === 'failed') {
        engine.failHermesJob(job.hermesJobId, {
          errorCategory: 'execution',
          safeMessage: record.safeMessage || 'Execution failed during approval.'
        });
      } else if (record.status === 'rejected') {
        engine.cancelHermesJob(job.hermesJobId, 'Approval rejected by admin');
      }
    }
  }

  return resultText;
}

async function handleHermesSearch(query, message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/hermes_search', chatId);
  }

  if (!query || !query.trim()) {
    return `Usage: /hermes_search <query_keyword>`;
  }

  const cleanQuery = query.trim();
  const search = require('../../openclaw/hermes/hermes-search');
  const formatters = require('../../openclaw/hermes/hermes-trace-formatters');
  const results = search.searchHermesJobs(cleanQuery, { limit: 10 });

  if (results.length === 0) {
    return `No jobs found matching query '${cleanQuery}'.`;
  }

  let msg = `🔍 *Hermes Search Results for '${cleanQuery}' (Max 10)*\n\n`;
  const formatted = results.map(j => formatters.formatOneLineSummary(j));
  msg += formatted.join('\n');
  return msg;
}

async function handleHermesTrace(jobId, message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/hermes_trace', chatId);
  }

  if (!jobId || !jobId.trim()) {
    return `Usage: /hermes_trace <hermesJobId>`;
  }

  const cleanJobId = jobId.trim();
  const obs = require('../../openclaw/hermes/hermes-observability');
  return obs.buildHermesTrace(cleanJobId);
}

async function handleHermesFailures(message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/hermes_failures', chatId);
  }

  const obs = require('../../openclaw/hermes/hermes-observability');
  return obs.buildHermesFailureSummary(10);
}

async function handleHermesHealth(message) {
  const roles = require('../../openclaw/runtime/runtime-roles');
  const chatId = message.chat?.id ? String(message.chat.id).trim() : 'unknown';
  const caps = roles.getEffectiveCapabilities(chatId);
  if (!caps.has('read_runtime')) {
    return roles.formatRoleDenied('/hermes_health', chatId);
  }

  const obs = require('../../openclaw/hermes/hermes-observability');
  return obs.buildHermesQueueSummary();
}


// =====================================================================
// Jarvis Assistant Command Handlers (Phase 2)
// =====================================================================

async function handleJarvisBrief(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_brief', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_brief', permCheck.reason, message);
  }
  const controller = require('../../jarvis/controller');
  try {
    const result = await controller.getDailyBrief();
    return typeof result === 'object' ? result.raw_brief_markdown : result;
  } catch (err) {
    return `❌ Error generating Daily Brief: ${err.message}`;
  }
}

async function handleJarvisYesterday(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_yesterday', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_yesterday', permCheck.reason, message);
  }
  const controller = require('../../jarvis/controller');
  try {
    return await controller.getYesterdaySummary();
  } catch (err) {
    return `❌ Error generating yesterday's summary: ${err.message}`;
  }
}

async function handleJarvisProject(slug, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_project', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_project', permCheck.reason, message);
  }
  if (!slug) {
    return `Usage: /jarvis_project <project_slug>\nExample: /jarvis_project septivolt`;
  }
  const controller = require('../../jarvis/controller');
  try {
    return await controller.getProjectStatus(slug);
  } catch (err) {
    return `❌ Error fetching project status: ${err.message}`;
  }
}

async function handleJarvisNext(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_next', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_next', permCheck.reason, message);
  }
  const controller = require('../../jarvis/controller');
  try {
    return await controller.getNextActions();
  } catch (err) {
    return `❌ Error fetching next actions: ${err.message}`;
  }
}

async function handleJarvisMobileInbox(filter, message) {
  let actualFilter = filter;
  let actualMessage = message;
  if (filter && typeof filter === 'object' && filter.chat) {
    actualMessage = filter;
    actualFilter = undefined;
  }
  
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_mobile_inbox', actualMessage);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_mobile_inbox', permCheck.reason, actualMessage);
  }
  const controller = require('../../jarvis/controller');
  try {
    return await controller.getMobileInbox(actualFilter);
  } catch (err) {
    return `❌ Error fetching mobile inbox: ${err.message}`;
  }
}

async function handleJarvisMarkProcessed(uploadId, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_mark_processed', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_mark_processed', permCheck.reason, message);
  }
  
  if (!uploadId) {
    return `❌ Usage: /jarvis_mark_processed <uploadId>`;
  }

  const controller = require('../../jarvis/controller');
  try {
    await controller.markUploadProcessed(uploadId);
    return `✅ Mobile upload \`${uploadId}\` has been marked as processed.`;
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleJarvisProcessInbox(uploadId, projectSlug, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_process_inbox', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_process_inbox', permCheck.reason, message);
  }
  
  if (!uploadId || !projectSlug) {
    return `❌ Usage: /jarvis_process_inbox <uploadId> <project_slug>`;
  }

  const controller = require('../../jarvis/controller');
  try {
    const record = await controller.processUploadToProject(uploadId, projectSlug);
    return [
      `✅ *Mobile Upload Processed & Assigned*`,
      ``,
      `• *Upload ID:* \`${record.id}\``,
      `• *Project:* \`${record.project_slug}\``,
      `• *Source:* \`${record.intake_source.toUpperCase()}\``,
      `• *Type:* \`${record.task_type}\``,
      `• *Content:* ${record.text_content}`,
      `• *Status:* \`Processed\``
    ].join('\n');
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleJarvisProcessLatest(projectSlug, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_process_latest', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_process_latest', permCheck.reason, message);
  }
  
  if (!projectSlug) {
    return `❌ Usage: /jarvis_process_latest <project_slug>`;
  }

  const controller = require('../../jarvis/controller');
  try {
    const record = await controller.processLatestUpload(projectSlug);
    return [
      `✅ *Latest Mobile Upload Processed & Assigned*`,
      ``,
      `• *Upload ID:* \`${record.id}\``,
      `• *Project:* \`${record.project_slug}\``,
      `• *Source:* \`${record.intake_source.toUpperCase()}\``,
      `• *Type:* \`${record.task_type}\``,
      `• *Content:* ${record.text_content || 'none'}`,
      `• *Status:* \`Processed\``
    ].join('\n');
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleJarvisArchiveProcessed(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_archive_processed', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_archive_processed', permCheck.reason, message);
  }

  const controller = require('../../jarvis/controller');
  try {
    const count = await controller.archiveProcessedUploads();
    return `🧹 *Inbox Cleaned*\n\nSuccessfully archived *${count}* processed uploads from the database.`;
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleJarvisFolders(filter, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_folders', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_folders', permCheck.reason, message);
  }

  const localInventory = require('../../jarvis/local-inventory');
  try {
    const folders = await localInventory.listLocalFolders(filter);
    if (folders.length === 0) {
      const filterDesc = filter ? ` (${filter})` : '';
      return `📁 *Jarvis Local Folders*\n\nNo matching folders${filterDesc} registered in the database.`;
    }
    
    let md = `📁 *Jarvis Local Folders*\n\n`;
    const cleanFilter = filter ? filter.trim().toLowerCase() : null;
    if (cleanFilter === 'pending') {
      md = `📁 *Pending Local Folders*\n\n`;
    } else if (cleanFilter === 'approved') {
      md = `📁 *Approved Local Folders*\n\n`;
    }

    for (const f of folders) {
      const status = f.approved ? '✅ Approved' : '⏳ Pending Approval';
      md += `• *Path:* \`${f.folder_path}\`\n  *Status:* ${status}\n  *ID:* \`${f.id}\`\n\n`;
    }
    return md;
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleJarvisAddFolder(folderPath, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_add_folder', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_add_folder', permCheck.reason, message);
  }

  if (!folderPath) {
    return `❌ Error: Please specify a folder path. Example: \`/jarvis_add_folder C:/my-projects\``;
  }

  const localInventory = require('../../jarvis/local-inventory');
  try {
    const folder = await localInventory.addLocalFolder(folderPath);
    return [
      `📁 *Folder Registered (Pending Approval)*`,
      ``,
      `• *Path:* \`${folder.folder_path}\``,
      `• *ID:* \`${folder.id}\``,
      `• *Status:* \`Pending Approval\``,
      ``,
      `Use \`/jarvis_approve_folder ${folder.id}\` to approve this path for indexing.`
    ].join('\n');
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleJarvisApproveFolder(idOrPath, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_approve_folder', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_approve_folder', permCheck.reason, message);
  }

  if (!idOrPath) {
    return `❌ Error: Please specify a folder ID or path to approve.`;
  }

  const localInventory = require('../../jarvis/local-inventory');
  try {
    const folder = await localInventory.approveLocalFolder(idOrPath);
    return [
      `✅ *Folder Approved for Indexing*`,
      ``,
      `• *Path:* \`${folder.folder_path}\``,
      `• *ID:* \`${folder.id}\``,
      `• *Status:* \`Approved\``,
      ``,
      `Use \`/jarvis_scan\` to scan files in approved directories.`
    ].join('\n');
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleJarvisScan(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_scan', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_scan', permCheck.reason, message);
  }

  const localInventory = require('../../jarvis/local-inventory');
  try {
    const stats = await localInventory.scanApprovedFolders();
    return [
      `🔍 *File Inventory Scan Complete*`,
      ``,
      `• *Folders Scanned:* ${stats.foldersScanned}`,
      `• *Files Indexed/Updated:* ${stats.filesIndexed}`,
      `• *Stale File Indexes Removed:* ${stats.filesRemoved}`,
      ``,
      `⚠️ *Safety Notice:* Stale database index records for deleted/renamed files were removed, but no local files on your machine were modified, moved, opened, or deleted.`,
      ``,
      `Use \`/jarvis_files\` to list indexed files and check project suggestions.`
    ].join('\n');
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleJarvisFiles(filter, arg, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_files', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_files', permCheck.reason, message);
  }

  const localInventory = require('../../jarvis/local-inventory');
  try {
    const suggestions = await localInventory.getFileSuggestions(filter || null, arg || null);
    if (suggestions.length === 0) {
      const filterDesc = filter ? ` with filter '${filter}'` : '';
      const argDesc = arg ? ` and argument '${arg}'` : '';
      return `📄 *Indexed Local Files*\n\nNo files found in the index${filterDesc}${argDesc}.`;
    }

    let md = `📄 *Indexed Local Files & Suggestions*\n\n`;
    const cleanFilter = filter ? filter.trim().toLowerCase() : null;
    const cleanArg = arg ? arg.trim().toLowerCase() : null;

    if (cleanFilter === 'recent') {
      md = `📄 *Recent Indexed Files*\n\n`;
    } else if (cleanFilter === 'large') {
      md = `📄 *Largest Indexed Files*\n\n`;
    } else if (cleanFilter === 'by_type') {
      md = `📄 *Indexed Files of Type: ${cleanArg}*\n\n`;
    } else if (cleanFilter === 'unmatched') {
      md = `📄 *Unmatched Indexed Files*\n\n`;
    } else if (cleanFilter === 'project') {
      md = `📄 *Indexed Files for Project: ${cleanArg}*\n\n`;
    } else if (cleanFilter) {
      md = `📄 *Indexed Files for Project: ${cleanFilter}*\n\n`;
    }

    const displayed = suggestions.slice(0, 15);
    for (const s of displayed) {
      const sizeKb = (s.size_bytes / 1024).toFixed(1);
      const date = new Date(s.last_modified).toISOString().substring(0, 16).replace('T', ' ');
      md += `• *${s.file_name}* (${sizeKb} KB, modified: _${date}_)\n`;
      md += `  *Path:* \`${s.file_path}\`\n`;
      if (s.suggested_project) {
        md += `  *Suggested Project:* \`${s.suggested_project}\` (Reason: ${s.reason})\n`;
      } else {
        md += `  *Suggested Project:* \`None\`\n`;
      }
      md += `\n`;
    }

    if (suggestions.length > displayed.length) {
      md += `_...and ${suggestions.length - displayed.length} more files._`;
    }

    return md;
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleJarvisConnectors(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_connectors', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_connectors', permCheck.reason, message);
  }

  const connectorsSummary = require('../../jarvis/connectors-summary');
  try {
    const list = await connectorsSummary.listConnectorsStatus();
    let md = `🔗 *Jarvis Cloud Connectors Status*\n\n`;
    for (const c of list) {
      const statusIcon = c.status === 'Active' ? '✅' : (c.status === 'Disabled' ? '🚫' : '⚠️');
      const lastSync = c.last_sync_time 
        ? `_Last sync:_ ${new Date(c.last_sync_time).toISOString().substring(0, 16).replace('T', ' ')}` 
        : '_Last sync:_ never';
      const lastUsed = c.last_used_at
        ? `_Last used:_ ${new Date(c.last_used_at).toISOString().substring(0, 16).replace('T', ' ')}`
        : '_Last used:_ never';
      
      md += `${statusIcon} *${c.name}*\n`;
      md += `  *ID:* \`${c.connector_id}\`\n`;
      md += `  *Status:* \`${c.status}\`\n`;
      md += `  *Read Scopes:* \`${c.read_permissions.join(', ')}\`\n`;
      md += `  ${lastSync}\n`;
      md += `  ${lastUsed}\n`;
      if (c.status === 'Revoked' || c.status === 'Needs Reconnect' || c.status === 'Not Authorized' || c.status === 'Decryption Error') {
        md += `  *Instruction:* Run \`/jarvis_reconnect_google ${c.connector_id}\` to connect/reconnect.\n`;
      }
      md += `\n`;
    }
    return md;
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleJarvisReconnectGoogle(args, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_reconnect_google', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_reconnect_google', permCheck.reason, message);
  }

  const parts = (args || '').trim().split(/\s+/);
  const connectorId = parts[0];
  const force = parts[1] === 'force';

  if (connectorId !== 'gmail' && connectorId !== 'google_drive') {
    return `❌ Usage: \`/jarvis_reconnect_google <gmail|google_drive> [force]\``;
  }

  const { createAuthTicket } = require('../../jarvis/auth-tickets');
  const ticket = await createAuthTicket('google_oauth_connect', { connector: connectorId }, 300);

  const publicUrl = getPublicBaseUrl();
  const url = `${publicUrl}/api/jarvis/google/connect?ticket=${ticket}${force ? '&force=true' : ''}`;
  
  return `🔗 *Google Connector Authentication*\n\nClick the link below to authorize Jarvis access to your ${connectorId === 'gmail' ? 'Gmail (Read-Only)' : 'Google Drive (Metadata Read-Only)'} (valid for 5 minutes):\n\n[Connect to Google](${url})\n\n_Note: This link uses a single-use authorization ticket and can only be clicked once._`;
}

async function handleJarvisEmailSummary(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_email_summary', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_email_summary', permCheck.reason, message);
  }

  const connectorsSummary = require('../../jarvis/connectors-summary');
  try {
    const emails = await connectorsSummary.getEmailSummary();
    if (emails === null) {
      return `⚠️ *Gmail Connector is not authorized.*\n\nPlease configure your Gmail OAuth refresh token in \`jarvis_connector_tokens\` or via environmental variables.`;
    }
    if (emails.length === 0) {
      return `📬 *Unread Actionable Emails Summary*\n\nYour inbox is clear! No unread important emails found.`;
    }

    let md = `📬 *Unread Actionable Emails Summary*\n\n`;
    let itemsShown = 0;
    let truncated = false;
    for (const email of emails) {
      const priorityLabel = email.priority_keyword ? ` 🔥 *[PRIORITY: ${email.priority_keyword.toUpperCase()}]*` : '';
      const projLabel = email.suggested_project ? ` (Suggested Project: \`${email.suggested_project}\`)` : '';
      const nextItem = `• *Subject:* ${email.subject}${priorityLabel}\n` +
                       `  *From:* \`${email.from}\`${projLabel}\n` +
                       `  *Snippet:* _${email.snippet}_\n\n`;
      
      if (md.length + nextItem.length > 3900) {
        truncated = true;
        break;
      }
      md += nextItem;
      itemsShown++;
    }
    if (truncated) {
      md += `⚠️ _Note: Showing ${itemsShown} of ${emails.length} unread emails due to Telegram message length limits._`;
    }
    return md;
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleJarvisDriveRecent(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_drive_recent', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_drive_recent', permCheck.reason, message);
  }

  const connectorsSummary = require('../../jarvis/connectors-summary');
  try {
    const files = await connectorsSummary.getDriveSummary();
    if (files === null) {
      return `⚠️ *Google Drive Connector is not authorized.*\n\nPlease configure your Google Drive OAuth refresh token in \`jarvis_connector_tokens\` or via environmental variables.`;
    }
    if (files.length === 0) {
      return `🗂️ *Recent Google Drive Modifications*\n\nNo recently modified files found.`;
    }

    let md = `🗂️ *Recent Google Drive Modifications*\n\n`;
    let itemsShown = 0;
    let truncated = false;
    for (const f of files) {
      const sizeStr = f.size_bytes ? ` (${(f.size_bytes / 1024).toFixed(1)} KB)` : '';
      const date = new Date(f.modifiedTime).toISOString().substring(0, 16).replace('T', ' ');
      const projLabel = f.suggested_project ? ` (Project: \`${f.suggested_project}\`)` : '';
      const nextItem = `• *[${f.name}](${f.webViewLink})*${sizeStr}${projLabel}\n` +
                       `  *Modified:* _${date}_\n\n`;
      
      if (md.length + nextItem.length > 3900) {
        truncated = true;
        break;
      }
      md += nextItem;
      itemsShown++;
    }
    if (truncated) {
      md += `⚠️ _Note: Showing ${itemsShown} of ${files.length} recent files due to Telegram message length limits._`;
    }
    return md;
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleJarvisPriorities(filter, arg, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_priorities', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_priorities', permCheck.reason, message);
  }

  const { getPriorityIntelligence } = require('../../jarvis/intelligence');
  try {
    const intel = await getPriorityIntelligence();
    const cleanFilter = (filter || 'today').toLowerCase().trim();

    if (cleanFilter === 'today') {
      if (intel.topThreePriorities.length === 0) {
        return `🧠 *Jarvis Top Priorities for Today*\n\n✅ No urgent priorities found. All clear!`;
      }
      let md = `🧠 *Jarvis Top Priorities for Today*\n\n`;
      intel.topThreePriorities.forEach((p, idx) => {
        md += `${idx + 1}. *${p.heading}* (ID: \`${p.priority_id}\`)\n   • ${p.why}\n   • ${p.nextAction}\n\n`;
      });
      return md;
    }

    if (cleanFilter === 'urgent') {
      const urgentItems = intel.rankedItems.filter(item => 
        item.score >= 25 || 
        (item.reasons && (
          item.reasons.includes('urgency language') || 
          item.reasons.includes('payment language') || 
          item.reasons.includes('deadline language')
        ))
      );
      if (urgentItems.length === 0) {
        return `🧠 *Urgent Priorities Filter*\n\nNo urgent items found matching criteria.`;
      }
      let md = `🧠 *Urgent Priorities (Score >= 25 or Urgent Keywords)*\n\n`;
      urgentItems.forEach((p, idx) => {
        md += `${idx + 1}. *${p.heading}* (Score: \`${p.score}\` | ID: \`${p.priority_id}\`)\n   • ${p.why}\n   • ${p.nextAction}\n\n`;
      });
      return md;
    }

    if (cleanFilter === 'project') {
      const cleanSlug = (arg || '').toLowerCase().trim();
      if (!cleanSlug) {
        return `❌ Usage: \`/jarvis_priorities project <project-slug>\``;
      }
      const projItems = intel.rankedItems.filter(item => 
        item.project_slug === cleanSlug
      );
      if (projItems.length === 0) {
        return `🧠 *Project Priorities Filter: \`${cleanSlug}\`*\n\nNo priorities found for project slug \`${cleanSlug}\`.`;
      }
      let md = `🧠 *Priorities for Project \`${cleanSlug}\`*\n\n`;
      projItems.forEach((p, idx) => {
        md += `${idx + 1}. *${p.heading}* (Score: \`${p.score}\` | ID: \`${p.priority_id}\`)\n   • ${p.why}\n   • ${p.nextAction}\n\n`;
      });
      return md;
    }

    if (cleanFilter === 'ignored') {
      if (!intel.ignoredIds || intel.ignoredIds.length === 0) {
        return `🧠 *Ignored Priorities*\n\nNo ignored items recorded.`;
      }
      let md = `🧠 *Ignored Priorities*\n\n`;
      intel.ignoredIds.forEach((id, idx) => {
        md += `${idx + 1}. ID: \`${id}\`\n`;
      });
      return md;
    }

    if (cleanFilter === 'pinned') {
      if (!intel.pinnedIds || intel.pinnedIds.length === 0) {
        return `🧠 *Pinned Priorities*\n\nNo pinned items/projects recorded.`;
      }
      let md = `🧠 *Pinned Priorities*\n\n`;
      intel.pinnedIds.forEach((id, idx) => {
        md += `${idx + 1}. ID: \`${id}\`\n`;
      });
      return md;
    }

    return `❌ Invalid filter. Supported: \`today\`, \`urgent\`, \`project <slug>\`, \`ignored\`, \`pinned\`.`;
  } catch (err) {
    return `❌ Error fetching priorities: ${err.message}`;
  }
}

async function handleJarvisFollowups(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_followups', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_followups', permCheck.reason, message);
  }

  const { getPriorityIntelligence } = require('../../jarvis/intelligence');
  try {
    const intel = await getPriorityIntelligence();
    if (intel.followUps.length === 0) {
      return `👥 *Client & Project Follow-ups*\n\n✅ No follow-ups pending. All client items clear!`;
    }
    let md = `👥 *Client & Project Follow-ups*\n\n`;
    intel.followUps.forEach(item => {
      if (item.type === 'email') {
        const fromName = (item.raw.from || '').split('<')[0].trim();
        md += `• *[Gmail]* From \`${fromName || 'Unknown'}\`: "${item.raw.subject}" (ID: \`${item.priority_id}\`)\n`;
      } else {
        const content = (item.raw.text_content || 'No content').substring(0, 50).trim();
        md += `• *[Mobile Inbox]* "${content}" (ID: \`${item.priority_id}\`)\n`;
      }
    });
    return md;
  } catch (err) {
    return `❌ Error fetching follow-ups: ${err.message}`;
  }
}

async function handleJarvisBlockersCmd(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_blockers', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_blockers', permCheck.reason, message);
  }

  const { getPriorityIntelligence } = require('../../jarvis/intelligence');
  try {
    const intel = await getPriorityIntelligence();
    const activeBlockers = intel.rankedItems.filter(item => item.type === 'blocker');
    if (activeBlockers.length === 0) {
      return `🛑 *Active Project Blockers*\n\n✅ No active blockers recorded. All systems stable!`;
    }
    let md = `🛑 *Active Project Blockers*\n\n`;
    activeBlockers.forEach(item => {
      const isStale = (Date.now() - new Date(item.raw.created_at).getTime() > 2 * 24 * 60 * 60 * 1000);
      const staleLabel = isStale ? ` ⚠️ *[STALE]*` : '';
      md += `• **[${item.project_slug || 'system'}]** ${item.raw.description}${staleLabel} (ID: \`${item.priority_id}\`)\n`;
      if (item.raw.steps_to_resolve) {
        md += `  *Steps to resolve:* ${item.raw.steps_to_resolve}\n`;
      }
      md += `\n`;
    });
    return md;
  } catch (err) {
    return `❌ Error fetching blockers: ${err.message}`;
  }
}

async function handleJarvisBriefFeedback(type, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_brief_good', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_brief_good', permCheck.reason, message);
  }

  const { saveBriefFeedback } = require('../../jarvis/controller');
  const todayStr = new Date().toISOString().substring(0, 10);
  try {
    await saveBriefFeedback(todayStr, type);
    return `✅ Thank you! Logged daily brief feedback as *${type.toUpperCase()}* for today (${todayStr}).`;
  } catch (err) {
    return `❌ Error logging brief feedback: ${err.message}`;
  }
}

async function handleJarvisPriorityFeedback(args, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_priority_feedback', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_priority_feedback', permCheck.reason, message);
  }

  const parts = args.trim().split(/\s+/);
  const priorityId = parts[0];
  const note = parts.slice(1).join(' ');

  if (!priorityId || !note) {
    return `❌ Usage: \`/jarvis_priority_feedback <priority_id> <note>\``;
  }

  const { savePriorityFeedback } = require('../../jarvis/controller');
  try {
    await savePriorityFeedback(priorityId, 'note', note);
    return `✅ Logged priority note feedback for item \`${priorityId}\`:\n_"${note}"_`;
  } catch (err) {
    return `❌ Error logging priority feedback: ${err.message}`;
  }
}

async function handleJarvisIgnorePriority(args, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_ignore_priority', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_ignore_priority', permCheck.reason, message);
  }

  const priorityId = args.trim();
  if (!priorityId) {
    return `❌ Usage: \`/jarvis_ignore_priority <priority_id>\``;
  }

  const { savePriorityFeedback } = require('../../jarvis/controller');
  try {
    await savePriorityFeedback(priorityId, 'ignored');
    return `✅ Ignored item \`${priorityId}\`. It will be de-prioritized in future morning briefs.`;
  } catch (err) {
    return `❌ Error ignoring priority: ${err.message}`;
  }
}

async function handleJarvisPinPriority(args, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_pin_priority', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_pin_priority', permCheck.reason, message);
  }

  const priorityId = args.trim();
  if (!priorityId) {
    return `❌ Usage: \`/jarvis_pin_priority <priority_id>\``;
  }

  const { savePriorityFeedback } = require('../../jarvis/controller');
  try {
    await savePriorityFeedback(priorityId, 'pinned');
    return `✅ Pinned item/project \`${priorityId}\`. It will be promoted in future morning briefs.`;
  } catch (err) {
    return `❌ Error pinning priority: ${err.message}`;
  }
}

async function handleJarvisActionPreview(priorityId, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_action_preview', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_action_preview', permCheck.reason, message);
  }

  const cleanId = priorityId.trim();
  if (!cleanId) {
    return `❌ Usage: \`/jarvis_action_preview <priority_id>\``;
  }

  const { getActionPreview } = require('../../jarvis/controller');
  try {
    const preview = await getActionPreview(cleanId);
    if (!preview.allowed) {
      return `❌ Proposal Unavailable: ${preview.message || 'Action cannot be proposed.'}`;
    }

    return `🔍 *Jarvis Action Preview*\n\n` +
           `• *Priority ID:* \`${preview.priority_id}\`\n` +
           `• *Recommended Action:* ${preview.recommended_action}\n` +
           `• *Risk Level:* *${preview.risk_level.toUpperCase()}*\n` +
           `• *Project:* \`${preview.project_slug}\`\n` +
           `• *What will happen if approved:* ${preview.what_will_happen}\n` +
           `• *What will NOT happen:* ${preview.what_will_not_happen}\n\n` +
           `To propose this action for approval, run:\n` +
           `\`/jarvis_propose_action ${preview.priority_id}\``;
  } catch (err) {
    return `❌ Error generating action preview: ${err.message}`;
  }
}

async function handleJarvisProposeAction(priorityId, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_propose_action', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_propose_action', permCheck.reason, message);
  }

  const cleanId = priorityId.trim();
  if (!cleanId) {
    return `❌ Usage: \`/jarvis_propose_action <priority_id>\``;
  }

  const { proposeAction } = require('../../jarvis/controller');
  try {
    const prop = await proposeAction(cleanId);
    return `📝 *Action Proposal Created*\n\n` +
           `• *Proposal ID:* \`${prop.id}\`\n` +
           `• *Priority ID:* \`${prop.priority_id}\`\n` +
           `• *Action:* ${prop.requested_action}\n` +
           `• *Risk Level:* *${prop.risk_level.toUpperCase()}*\n` +
           `• *Status:* \`${prop.status}\`\n` +
           `• *Expires At:* ${prop.expires_at}\n\n` +
           `To approve and execute this proposed action, run:\n` +
           `\`/jarvis_approve ${prop.id}\``;
  } catch (err) {
    return `❌ Error proposing action: ${err.message}`;
  }
}

async function handleJarvisApprovals(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_approvals', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_approvals', permCheck.reason, message);
  }

  const { queryDb } = require('../../jarvis/controller');
  try {
    const rows = await queryDb(
      "SELECT id, requested_action, risk_level, status, created_at FROM jarvis_approval_requests WHERE status = 'pending' ORDER BY created_at DESC;"
    );

    if (rows.length === 0) {
      return `📥 *Pending Action Approvals*\n\n✅ No pending action approvals outstanding. All clear!`;
    }

    let md = `📥 *Pending Action Approvals*\n\n`;
    rows.forEach((r, idx) => {
      md += `${idx + 1}. *[${r.risk_level.toUpperCase()}]* ${r.requested_action}\n   • ID: \`${r.id}\`\n   • Created: _${new Date(r.created_at).toISOString().substring(0, 16).replace('T', ' ')}_\n\n`;
    });
    return md;
  } catch (err) {
    return `❌ Error fetching approvals: ${err.message}`;
  }
}

async function handleJarvisApprovalDetails(approvalId, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_approval', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_approval', permCheck.reason, message);
  }

  const cleanId = approvalId.trim();
  if (!cleanId) {
    return `❌ Usage: \`/jarvis_approval <approval_id>\``;
  }

  const { queryDb } = require('../../jarvis/controller');
  try {
    const rows = await queryDb("SELECT * FROM jarvis_approval_requests WHERE id = $1;", [cleanId]);
    if (rows.length === 0) {
      return `❌ Error: Approval request with ID "${cleanId}" not found.`;
    }

    const prop = rows[0];
    // Sensitive payload summarizer: clean up to avoid secret leaks
    const payloadStr = JSON.stringify(prop.proposed_payload || {}, null, 2);
    const safePayload = payloadStr.length > 500 ? payloadStr.substring(0, 500) + '\n... [truncated for display]' : payloadStr;

    return `🛡️ *Approval Request Details*\n\n` +
           `• *ID:* \`${prop.id}\`\n` +
           `• *Action:* ${prop.requested_action}\n` +
           `• *Type:* \`${prop.action_type || 'proposal'}\`\n` +
           `• *Project:* \`${prop.project_slug || 'system'}\`\n` +
           `• *Risk Level:* *${prop.risk_level.toUpperCase()}*\n` +
           `• *Status:* \`${prop.status}\`\n` +
           `• *Created At:* ${prop.created_at}\n` +
           `• *Expires At:* ${prop.expires_at || 'Never'}\n\n` +
           `📦 *Proposed Payload:* \n\`\`\`json\n${safePayload}\n\`\`\`\n\n` +
           `To authorize, run: \`/jarvis_approve ${prop.id}\`\n` +
           `To reject, run: \`/jarvis_reject ${prop.id}\``;
  } catch (err) {
    return `❌ Error retrieving approval request: ${err.message}`;
  }
}

async function handleJarvisApprove(approvalId, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_approve', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_approve', permCheck.reason, message);
  }

  const cleanId = approvalId.trim();
  if (!cleanId) {
    return `❌ Usage: \`/jarvis_approve <approval_id>\``;
  }

  const { approveRequest, executeApprovedAction } = require('../../jarvis/controller');
  try {
    const approvedBy = String(message.from?.id || 'admin');
    await approveRequest(cleanId, approvedBy);
    const executionResult = await executeApprovedAction(cleanId, approvedBy);
    return executionResult;
  } catch (err) {
    return `❌ Execution Error: ${err.message}`;
  }
}

async function handleJarvisReject(approvalId, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_reject', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_reject', permCheck.reason, message);
  }

  const cleanId = approvalId.trim();
  if (!cleanId) {
    return `❌ Usage: \`/jarvis_reject <approval_id>\``;
  }

  const { rejectApproval } = require('../../jarvis/controller');
  try {
    const actor = String(message.from?.id || 'admin');
    await rejectApproval(cleanId, actor);
    return `🛑 Rejected request \`${cleanId}\`. Jarvis will not execute this proposal.`;
  } catch (err) {
    return `❌ Error rejecting request: ${err.message}`;
  }
}

async function handleJarvisCancelApproval(approvalId, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_cancel_approval', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_cancel_approval', permCheck.reason, message);
  }

  const cleanId = approvalId.trim();
  if (!cleanId) {
    return `❌ Usage: \`/jarvis_cancel_approval <approval_id>\``;
  }

  const { cancelApproval } = require('../../jarvis/controller');
  try {
    const actor = String(message.from?.id || 'admin');
    await cancelApproval(cleanId, actor);
    return `🚫 Cancelled pending approval request \`${cleanId}\`.`;
  } catch (err) {
    return `❌ Error cancelling request: ${err.message}`;
  }
}

async function handleJarvisApprovalHistory(args, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_approval_history', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_approval_history', permCheck.reason, message);
  }

  const { queryDb, cleanupExpiredApprovals } = require('../../jarvis/controller');
  try {
    await cleanupExpiredApprovals();

    const cleanArgs = args.trim().toLowerCase();
    let sql = "SELECT * FROM jarvis_approval_requests WHERE 1=1";
    const params = [];
    let filterDescription = "All Approvals";

    if (cleanArgs === 'today') {
      sql += " AND created_at >= date_trunc('day', now())";
      filterDescription = "Proposed Today";
    } else if (cleanArgs.startsWith('project ')) {
      const slug = cleanArgs.substring(8).trim();
      if (!slug) {
        return "❌ Usage: `/jarvis_approval_history project <slug>`";
      }
      params.push(slug);
      sql += ` AND project_slug = $${params.length}`;
      filterDescription = `Project: ${slug}`;
    } else if (cleanArgs.startsWith('status ')) {
      const status = cleanArgs.substring(7).trim();
      const validStatuses = ['pending', 'approved', 'rejected', 'cancelled', 'expired', 'executed', 'failed'];
      if (!status || !validStatuses.includes(status)) {
        return `❌ Usage: \`/jarvis_approval_history status <${validStatuses.join('|')}>\``;
      }
      params.push(status);
      sql += ` AND status = $${params.length}`;
      filterDescription = `Status: ${status.toUpperCase()}`;
    } else if (cleanArgs !== '') {
      const validStatuses = ['pending', 'approved', 'rejected', 'cancelled', 'expired', 'executed', 'failed'];
      if (validStatuses.includes(cleanArgs)) {
        params.push(cleanArgs);
        sql += ` AND status = $${params.length}`;
        filterDescription = `Status: ${cleanArgs.toUpperCase()}`;
      } else {
        return "❌ Invalid argument. Available options:\n" +
               "• `/jarvis_approval_history` (all)\n" +
               "• `/jarvis_approval_history today`\n" +
               "• `/jarvis_approval_history project <slug>`\n" +
               "• `/jarvis_approval_history status <status>`";
      }
    }

    sql += " ORDER BY created_at DESC LIMIT 10;";
    const rows = await queryDb(sql, params);

    if (rows.length === 0) {
      return `📥 *Jarvis Approval History* (${filterDescription})\n\nNo matching approval requests found.`;
    }

    let out = `📥 *Jarvis Approval History* (${filterDescription})\n\n`;
    rows.forEach((r, idx) => {
      const timeStr = new Date(r.created_at).toLocaleString();
      const statusEmoji = r.status === 'pending' ? '⏳' :
                          r.status === 'approved' ? '✅' :
                          r.status === 'executed' ? '⚡' :
                          r.status === 'rejected' ? '🛑' :
                          r.status === 'cancelled' ? '🚫' : '⚠️';
      out += `${idx + 1}. *[${r.risk_level.toUpperCase()}]* ${statusEmoji} ${r.requested_action}\n` +
             `   • ID: \`${r.id}\`\n` +
             `   • Status: \`${r.status}\` | Project: \`${r.project_slug || 'system'}\`\n` +
             `   • Proposed: _${timeStr}_\n\n`;
    });

    return out.trim();
  } catch (err) {
    return `❌ Error retrieving history: ${err.message}`;
  }
}

async function handleJarvisApprovalStats(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_approval_stats', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_approval_stats', permCheck.reason, message);
  }

  const { queryDb, cleanupExpiredApprovals } = require('../../jarvis/controller');
  try {
    await cleanupExpiredApprovals();

    const statusRows = await queryDb(
      `SELECT status, count(*)::integer as count 
       FROM jarvis_approval_requests 
       GROUP BY status;`
    );

    const stats = {
      pending: 0,
      approved: 0,
      rejected: 0,
      cancelled: 0,
      expired: 0,
      executed: 0,
      failed: 0
    };

    let total = 0;
    statusRows.forEach(r => {
      if (r.status in stats) {
        stats[r.status] = r.count;
        total += r.count;
      }
    });

    const riskRows = await queryDb(
      `SELECT risk_level, count(*)::integer as count 
       FROM jarvis_approval_requests 
       GROUP BY risk_level;`
    );

    const riskStats = {
      low: 0,
      medium: 0,
      high: 0
    };

    riskRows.forEach(r => {
      const key = (r.risk_level || 'medium').toLowerCase();
      if (key in riskStats) {
        riskStats[key] = r.count;
      }
    });

    return `📊 *Jarvis Approval Statistics*

• *Total Requests:* \`${total}\`

*Status Summary:*
• ⏳ *Pending:* \`${stats.pending}\`
• ✅ *Approved:* \`${stats.approved}\`
• ⚡ *Executed:* \`${stats.executed}\`
• 🛑 *Rejected:* \`${stats.rejected}\`
• 🚫 *Cancelled:* \`${stats.cancelled}\`
• ⏰ *Expired:* \`${stats.expired}\`
• ❌ *Failed:* \`${stats.failed}\`

*Risk Level Breakdown:*
• *Low Risk:* \`${riskStats.low}\`
• *Medium Risk:* \`${riskStats.medium}\`
• *High Risk:* \`${riskStats.high}\``;
  } catch (err) {
    return `❌ Error retrieving statistics: ${err.message}`;
  }
}

async function handleCockpitToday(message) {
  const roles = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = roles.requireCommandPermission('/cockpit_today', message);
  if (!permCheck.allowed) {
    return roles.formatPermissionDenied('/cockpit_today', permCheck.reason, message);
  }

  const cockpit = require('../../openclaw/prospects/prospect-priority-cockpit');
  const items = cockpit.getCockpitData();
  const formatters = require('./hermes-card-formatters');
  return formatters.formatCockpitToday(items);
}

async function handleCockpitTop(message) {
  const roles = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = roles.requireCommandPermission('/cockpit_top', message);
  if (!permCheck.allowed) {
    return roles.formatPermissionDenied('/cockpit_top', permCheck.reason, message);
  }

  const cockpit = require('../../openclaw/prospects/prospect-priority-cockpit');
  const items = cockpit.getCockpitData();
  const formatters = require('./hermes-card-formatters');
  return formatters.formatCockpitTop(items);
}

async function handleCockpitDue(message) {
  const roles = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = roles.requireCommandPermission('/cockpit_due', message);
  if (!permCheck.allowed) {
    return roles.formatPermissionDenied('/cockpit_due', permCheck.reason, message);
  }

  const cockpit = require('../../openclaw/prospects/prospect-priority-cockpit');
  const items = cockpit.getCockpitData();
  const todayStr = new Date().toISOString().split('T')[0];

  const due = items.filter(item => item.nextFollowUpAt && item.nextFollowUpAt.substring(0, 10) <= todayStr);

  if (due.length === 0) {
    return `📅 No follow-ups due today or overdue.`;
  }

  let out = `📅 *Follow-ups Due Today or Overdue*\n\n`;
  due.forEach((item, idx) => {
    out += `${idx + 1}. *${item.businessName}*\n` +
           `   • Scheduled: \`${item.nextFollowUpAt}\` (Stage: ${item.followUpStage || 0})\n` +
           `   • Last Contact: \`${item.lastManualContactChannel || 'None'}\` (${item.manualContactCount} total)\n` +
           `   • Prospect ID: \`${item.prospectId}\`\n\n`;
  });

  return out.trim();
}

async function handleCockpitNext(message) {
  const roles = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = roles.requireCommandPermission('/cockpit_next', message);
  if (!permCheck.allowed) {
    return roles.formatPermissionDenied('/cockpit_next', permCheck.reason, message);
  }

  const cockpit = require('../../openclaw/prospects/prospect-priority-cockpit');
  const items = cockpit.getCockpitData();

  // List next 5 high-priority prospects to contact (not contacted yet)
  const next5 = items.filter(item => item.manualContactCount === 0).slice(0, 5);

  if (next5.length === 0) {
    return `🎯 No pending high-priority prospects to contact.`;
  }

  let out = `🚀 *Next 5 Prospects to Contact*\n\n`;
  next5.forEach((item, idx) => {
    const fitText = item.fitScore !== null ? `${item.fitScore}/100` : 'N/A';
    out += `${idx + 1}. *${item.businessName}*\n` +
           `   • Priority: *${item.priority.toUpperCase()}* | Fit: \`${fitText}\`\n` +
           `   • Recommended Channel: \`${item.recommendedChannel.toUpperCase()}\`\n` +
           `   • Offer Angle: _${item.recommendedOfferAngle}_\n` +
           `   • Prospect ID: \`${item.prospectId}\`\n\n`;
  });

  return out.trim();
}

async function handleJarvisSessionStart(slug, textContent, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_session_start', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_session_start', permCheck.reason, message);
  }
  if (!slug) {
    return '❌ Error: Please specify a project slug. Example: `/jarvis_session_start septivolt`';
  }
  const workSessions = require('../../jarvis/work-sessions');
  try {
    const session = await workSessions.startWorkSession(slug, 'telegram', textContent);
    return `🚀 *Work Session Started*\n\n• *Project:* \`${session.project_slug}\`\n• *Status:* \`${session.status}\`\n• *Started At:* ${new Date(session.started_at).toLocaleString()}`;
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleJarvisSessionUpdate(slug, summary, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_session_update', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_session_update', permCheck.reason, message);
  }
  if (!slug || !summary) {
    return '❌ Error: Please specify project slug and update summary. Example: `/jarvis_session_update septivolt Added new tests`';
  }
  const workSessions = require('../../jarvis/work-sessions');
  try {
    const session = await workSessions.updateWorkSession(slug, summary, 'telegram');
    return `📝 *Work Session Updated*\n\n• *Project:* \`${session.project_slug}\`\n• *Status:* \`${session.status}\`\n• *Summary:* \n${session.summary}`;
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleJarvisSessionDone(slug, summary, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_session_done', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_session_done', permCheck.reason, message);
  }
  if (!slug) {
    return '❌ Error: Please specify a project slug. Example: `/jarvis_session_done septivolt`';
  }
  const workSessions = require('../../jarvis/work-sessions');
  try {
    const session = await workSessions.doneWorkSession(slug, summary, 'telegram');
    return `🏁 *Work Session Completed*\n\n• *Project:* \`${session.project_slug}\`\n• *Status:* \`${session.status}\`\n• *Ended At:* ${new Date(session.ended_at).toLocaleString()}\n• *Final Summary:* \n${session.summary}`;
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleJarvisSessionStatus(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_session_status', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_session_status', permCheck.reason, message);
  }
  const workSessions = require('../../jarvis/work-sessions');
  try {
    const session = await workSessions.getActiveSession();
    if (!session) {
      return '💤 *No Active Work Session*\n\nUse `/jarvis_session_start <project_slug>` to start one.';
    }
    return `🧠 *Active Work Session*\n\n• *Project:* \`${session.project_slug}\`\n• *Status:* \`${session.status}\`\n• *Started At:* ${new Date(session.started_at).toLocaleString()}\n• *Summary:* \n${session.summary}`;
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleJarvisSessionLatest(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_session_latest', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_session_latest', permCheck.reason, message);
  }
  const workSessions = require('../../jarvis/work-sessions');
  try {
    const sessions = await workSessions.listWorkSessions(5);
    if (sessions.length === 0) {
      return '📂 *No Work Sessions Found*';
    }
    let md = '📂 *Latest Work Sessions*:\n\n';
    for (const s of sessions) {
      const date = new Date(s.created_at).toLocaleString();
      md += `• *[${s.project_slug.toUpperCase()}]* \`${s.status}\` at ${date}\n  *Summary:* ${s.summary || 'none'}\n\n`;
    }
    return md;
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleJarvisSessionProject(slug, message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_session_project', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_session_project', permCheck.reason, message);
  }
  if (!slug) {
    return '❌ Error: Please specify a project slug. Example: `/jarvis_session_project septivolt`';
  }
  const workSessions = require('../../jarvis/work-sessions');
  try {
    const sessions = await workSessions.getProjectSessions(slug);
    if (sessions.length === 0) {
      return `📂 *No Sessions Found for Project: ${slug}*`;
    }
    let md = `📂 *Sessions for Project: ${slug.toUpperCase()}*:\n\n`;
    for (const s of sessions) {
      const date = new Date(s.created_at).toLocaleString();
      md += `• *Status:* \`${s.status}\` at ${date}\n  *Summary:* ${s.summary || 'none'}\n\n`;
    }
    return md;
  } catch (err) {
    return `❌ Error: ${err.message}`;
  }
}

async function handleJarvisIngestHandoff(message) {
  const { requireCommandPermission, formatPermissionDenied } = require('../../openclaw/runtime/runtime-permissions');
  const permCheck = requireCommandPermission('/jarvis_ingest_handoff', message);
  if (!permCheck.allowed) {
    return formatPermissionDenied('/jarvis_ingest_handoff', permCheck.reason, message);
  }
  const workSessions = require('../../jarvis/work-sessions');
  try {
    const session = await workSessions.ingestHandoffFile();
    return `📥 *Handoff Ingested Successfully*\n\n• *Project:* \`${session.project_slug}\`\n• *Status:* \`${session.status}\`\n• *Files Changed:* \n${session.changed_files_summary || 'none'}\n• *Blockers:* \n${session.blockers || 'none'}\n• *Next Actions:* \n${session.next_actions || 'none'}`;
  } catch (err) {
    return `❌ Ingest Error: ${err.message}`;
  }
}

module.exports = {
  handleCommand,
  dispatchCommand,
  handleHermesApprove,
  handleCockpitToday,
  handleCockpitTop,
  handleCockpitDue,
  handleCockpitNext
};
