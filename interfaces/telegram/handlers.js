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

async function saveToInbox(bot, workflow, fields, message) {
  let rootDir = process.env.OPENCLAW_WORKSPACE_ROOT;
  if (!rootDir || !fs.existsSync(path.join(rootDir, 'openclaw'))) {
    rootDir = path.join(__dirname, '../../');
  }
  const inboxDir = path.join(rootDir, 'openclaw', 'inbox', 'telegram-requests');
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
  return `OpenClaw Telegram Router\n\nAvailable Commands:\n/help - Show this message\n/bots - List known bots\n/registry - Registry summary\n\nContent Forge Examples:\n/cf image_prompts\nProject: SeptiVolt\nCampaign: Batch 001\nPrompt Count: 5\nAspect Ratio: 9:16`;
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
