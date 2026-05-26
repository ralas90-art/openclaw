const { supabase } = require('../../lib/supabase');
const runtimeGovernor = require('../../core/coordination/runtimeGovernor');
const circuitBreakerRegistry = require('../../core/failover/circuitBreakerRegistry');
const { replayEvent } = require('../../core/replay/replayManager');
const fs = require('fs');
const path = require('path');

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
  const bots = { active: [], documented: [] };
  
  if (!fs.existsSync(registryPath)) return bots;

  const content = fs.readFileSync(registryPath, 'utf8');
  let currentSection = null;

  const lines = content.split('\n');
  for (const line of lines) {
    if (line.includes('## Active Bots')) currentSection = 'active';
    else if (line.includes('## Planned / Documented Bots')) currentSection = 'documented';
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
  if (registry.active.find(b => b.slug === slug)) return 'active';
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

  if (bot === 'content-forge') {
    if (workflow === 'image-prompts') {
      payload.next_manual_step = "Generate the selected prompt in Google Flow, save the output to: 03-generated-images/\nThen send:\n/content_forge video_prompt\nCampaign: [campaign name]\nSelected Image: [filename]\nDuration: 8 seconds\nPlatform: Instagram Reels\nCTA: Book a Demo";
    } else if (workflow === 'video-prompt') {
      payload.next_manual_step = "Generate the video in Veo/Gemini and save to 05-generated-videos/. Then run /content_forge qa_video.";
    }
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
  if (command === '/bots') return handleBots();
  if (command === '/registry') return handleRegistry();
  if (command === '/inbox') return await handleInbox();
  if (command === '/inbox_latest') return await handleInboxLatest();
  if (command === '/inbox_read') {
    const filename = text.trim().split(/\s+/)[1];
    return await handleInboxRead(filename);
  }

  // 2. OpenClaw Bot Routing
  if (command === '/content_forge' || command === '/cf') {
    return await handleOpenClawBot('content-forge', parsed.workflow, parsed.fields, message);
  }
  if (command === '/revenue') {
    return await handleOpenClawBot('revenue-master-orchestrator', parsed.workflow, parsed.fields, message);
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
  return `OpenClaw Telegram Router\n\nAvailable Commands:\n/help - Show this message\n/bots - List known bots\n/registry - Registry summary\n/inbox - List 5 most recent queued requests\n/inbox_latest - Show the latest request summary\n/inbox_read <filename> - Read a specific request\n\nContent Forge Examples:\n/cf image_prompts\nProject: SeptiVolt\nCampaign: Batch 001\nPrompt Count: 5\nAspect Ratio: 9:16`;
}

function handleBots() {
  const registry = parseRegistry();
  const active = registry.active.map(b => `- ${b.name}`).join('\n') || '- None';
  const documented = registry.documented.map(b => `- ${b.name}`).join('\n') || '- None';
  return `🤖 OpenClaw Bot Registry\n\nActive:\n${active}\n\nDocumented Only:\n${documented}`;
}

function handleRegistry() {
  const registry = parseRegistry();
  return `OpenClaw Bot Registry Summary\nTotal Active: ${registry.active.length}\nTotal Documented: ${registry.documented.length}\nType /bots for full list.`;
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

  // Active Bot
  const payload = await saveToInbox(botSlug, workflow, fields, message);
  
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

module.exports = { handleCommand };
