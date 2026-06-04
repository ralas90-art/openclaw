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
  if (command === '/drive_latest' || command === '/drivelatest') return await handleDriveLatest();
  if (command === '/drive_publish_latest' || command === '/drivepublishlatest') return await handleDrivePublishLatest();
  if (command === '/drive_publish_pending' || command === '/drivepublishpending') return await handleDrivePublishPending();
  if (command === '/drive_republish_latest' || command === '/driverepublishlatest') return await handleDriveRepublishLatest();
  if (command === '/drive_publish_file' || command === '/drivepublishfile') {
    const filename = text.trim().split(/\s+/)[1];
    return await handleDrivePublishFile(filename);
  }
  if (command === '/drive_publish_campaign' || command === '/drivepublishcampaign') {
    const campaignName = text.trim().split(/\s+/)[1];
    return await handleDrivePublishCampaign(campaignName);
  }
  if (command === '/run_bot' || command === '/run' || command === '/runtime_run') {
    return await handleRunBot(text, message);
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
  return `OpenClaw Telegram Router\n\nAvailable Commands:\n/help - Show this message\n/bots - List known bots\n/registry - Registry summary\n/inbox - List 5 most recent queued requests\n/inbox_latest - Show the latest request summary\n/inbox_read <filename> - Read a specific request\n/run_bot <bot_slug> <user_request> - Run approved bot workflow at runtime (also /run, /runtime_run)\n\nGoogle Drive Commands:\n/drive_latest - Show the latest published file info\n/drive_publish_latest - Publish the latest output (skips if already published)\n/drive_publish_pending - Publish the latest UNPUBLISHED output file only\n/drive_republish_latest - Force re-upload of the latest output file\n/drive_publish_file <filename> - Publish a specific result file\n/drive_publish_campaign <campaign> - Publish a campaign folder\n\nRecommended workflow:\n  1. /run_bot revenue-master-orchestrator <user_request>\n     or /run_bot content-forge <user_request>\n  2. /drive_publish_pending\n  3. /drive_latest\n\nBot Commands & Examples:\n1. Creative (Content Forge):\n   /cf image_prompts\n   Project: SeptiVolt\n   Campaign: Batch 001\n   Runtime Execution:\n   /run_bot content-forge Create 5 TikTok ad scripts for Cresca OS targeting cleaning business owners\n2. Business (Revenue Master):\n   /revenue system_design\n   Business Name: SeptiVolt\n   Business Type: SaaS\n   Runtime Execution:\n   /run_bot revenue-master-orchestrator Create a GHL system plan for SeptiVolt\n3. Tech (System Master):\n   /sys build_app\n   App Name: septivolt-portal\n   Framework: Next.js\n4. Copywriting (Cresca Content/AEO):\n   /aeo optimize_page\n   Page URL: https://septivolt.com\n5. Leads (Lead Acquisition):\n   /leads prospect\n   Target Location: Nassau County\n   Platform Focus: Google Ads\n6. Funnel Audit (Revenue Optimization):\n   /rev_opt audit\n   Funnel Link: https://ggcleaningli.com/quote\n7. Ops (Weekly Command):\n   /weekly review\n   Week Range: May 18 - May 24\n8. Monetize (Client Value):\n   /client_value upsell\n   Brand Name: Cresca OS\n9. Optimization Loop (Auto-Loop):\n   /autoloop review\n   System Being Audited: ad funnel`;
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

  const result = await runtimeExecutor.runBot(botSlug, userRequest, senderChatId);
  return result.message;
}

module.exports = { handleCommand };


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


async function handleDriveLatest() {
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
    roots.push(path.resolve(railwayRoot));
  }

  // 4. process.cwd() fallback
  const cwdRoot = process.cwd();
  if (isValidRepoRoot(cwdRoot)) {
    roots.push(path.resolve(cwdRoot));
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

async function handleDrivePublishLatest() {
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

async function handleDrivePublishPending() {
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

async function handleDriveRepublishLatest() {
  // Force re-uploads the latest file regardless of prior publish history.
  const result = await drivePublisher.republishLatestToDrive();

  if (result.status === 'no_file') {
    return "No generated output file found to republish.";
  }

  if (result.status === 'error') {
    return "❌ *Error:* " + result.message;
  }

  let msg = "🔄 *Google Drive Force Republish Result*\n\n";
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
    msg += "❌ *Republish Failed:* " + result.message;
  }

  return msg;
}

async function handleDrivePublishFile(filename) {
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

async function handleDrivePublishCampaign(campaignName) {
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
