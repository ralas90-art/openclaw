const { supabase } = require('../../lib/supabase');
const runtimeGovernor = require('../../core/coordination/runtimeGovernor');
const circuitBreakerRegistry = require('../../core/failover/circuitBreakerRegistry');
const { replayEvent } = require('../../core/replay/replayManager');
const fs = require('fs');
const path = require('path');
const drivePublisher = require('../../openclaw/integrations/google-drive-publisher/drive-publisher');
const runtimeExecutor = require('../../openclaw/runtime/runtime-executor');

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
// Core Handlers
// ------------------------------------------

async function handleCommand(text, message) {
  if (!text) return;
  const parsed = parseMultilineCommand(text);
  const command = parsed.command;

  // 1. Registry & Help Commands
  if (command === '/help') return handleHelp();
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
  return `OpenClaw Telegram Router\n\nAvailable Commands:\n/help - Show this message\n/bots - List known bots\n/registry - Registry summary\n/inbox - List 5 most recent queued requests\n/inbox_latest - Show the latest request summary\n/inbox_read <filename> - Read a specific request\n/run_bot <bot_slug> <user_request> - Run approved bot workflow at runtime (also /run, /runtime_run)
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

module.exports = { handleCommand };
