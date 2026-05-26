const { supabase } = require('../../lib/supabase');
const runtimeGovernor = require('../../core/coordination/runtimeGovernor');
const circuitBreakerRegistry = require('../../core/failover/circuitBreakerRegistry');
const { replayEvent } = require('../../core/replay/replayManager');
const fs = require('fs');
const path = require('path');
const drivePublisher = require('../../openclaw/integrations/google-drive-publisher/drive-publisher');

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
  if (command === '/inbox_latest' || command === '/inboxlatest') return await handleInboxLatest();
  if (command === '/inbox_read' || command === '/inboxread') {
    const filename = text.trim().split(/\s+/)[1];
    return await handleInboxRead(filename);
  }
  if (command === '/drive_latest' || command === '/drivelatest') return await handleDriveLatest();
  if (command === '/drive_publish_latest' || command === '/drivepublishlatest') return await handleDrivePublishLatest();
  if (command === '/drive_publish_file' || command === '/drivepublishfile') {
    const filename = text.trim().split(/\s+/)[1];
    return await handleDrivePublishFile(filename);
  }
  if (command === '/drive_publish_campaign' || command === '/drivepublishcampaign') {
    const campaignName = text.trim().split(/\s+/)[1];
    return await handleDrivePublishCampaign(campaignName);
  }


  // 2. OpenClaw Bot Routing
  if (command === '/content_forge' || command === '/contentforge' || command === '/cf') {
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
  return `OpenClaw Telegram Router\n\nAvailable Commands:\n/help - Show this message\n/bots - List known bots\n/registry - Registry summary\n/inbox - List 5 most recent queued requests\n/inbox_latest - Show the latest request summary\n/inbox_read <filename> - Read a specific request\n\nGoogle Drive Commands:\n/drive_latest - Show the latest published file\n/drive_publish_latest - Publish the latest output file to Drive\n/drive_publish_file <filename> - Publish a specific result file\n/drive_publish_campaign <campaign> - Publish a campaign folder\n\nContent Forge Examples:\n/cf image_prompts\nProject: SeptiVolt\nCampaign: Batch 001`;
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
  let debugMsg = "";
  try {
    const envRoot = process.env.OPENCLAW_WORKSPACE_ROOT || "undefined";
    const envRootValid = envRoot !== "undefined" ? isValidRepoRoot(path.resolve(envRoot)) : false;
    const roots = getActiveRoots();
    
    debugMsg += `\n\n🔍 Debug Info:\n`;
    debugMsg += `• envRoot: ${envRoot}\n`;
    debugMsg += `• envRoot valid repo: ${envRootValid}\n`;
    debugMsg += `• resolved roots: [${roots.join(', ')}]\n`;
    debugMsg += `• __dirname: ${__dirname}\n`;
    
    roots.forEach(rootDir => {
      const registryPath = path.join(rootDir, 'openclaw', 'bots', 'registry.md');
      const responsesDir = path.resolve(rootDir, 'openclaw/outbox/telegram-responses');
      const reportsDir = path.resolve(rootDir, 'openclaw/reports');
      const campaignsDir = path.resolve(rootDir, 'campaigns');
      debugMsg += `• root: ${rootDir}\n`;
      debugMsg += `  - registry exists: ${fs.existsSync(registryPath)}\n`;
      debugMsg += `  - responsesDir: ${responsesDir}\n`;
      debugMsg += `  - responsesDir exists: ${fs.existsSync(responsesDir)}\n`;
      debugMsg += `  - reportsDir exists: ${fs.existsSync(reportsDir)}\n`;
      debugMsg += `  - campaignsDir exists: ${fs.existsSync(campaignsDir)}\n`;
      if (fs.existsSync(responsesDir)) {
        const files = fs.readdirSync(responsesDir);
        debugMsg += `  - responses files: [${files.join(', ')}]\n`;
      }
    });
  } catch (err) {
    debugMsg += `• debug error: ${err.message}\n`;
  }

  const latestFile = getLatestOutputFile();
  if (!latestFile) {
    // Check if any manifest or other files exist in the responses folder in any active root
    const roots = getActiveRoots();
    let hasManifests = false;
    for (const rootDir of roots) {
      const responsesDir = path.join(rootDir, 'openclaw', 'outbox', 'telegram-responses');
      if (fs.existsSync(responsesDir)) {
        const files = fs.readdirSync(responsesDir);
        if (files.some(f => f.endsWith('_manifest.json') || f.includes('publish_manifest'))) {
          hasManifests = true;
          break;
        }
      }
    }

    if (hasManifests) {
      return "No publishable output file found yet.\n\nI found internal manifests, but no user-facing result file such as:\n*_result.md\n\nProcess an inbox request first and generate a result file in:\nopenclaw/outbox/telegram-responses/" + debugMsg;
    }
    
    return "No generated output file found yet. Process an inbox request first, then run /drive_publish_latest." + debugMsg;
  }

  const options = {};
  if (latestFile.replace(/\\/g, '/').toLowerCase().includes('campaigns/')) {
    const parts = latestFile.replace(/\\/g, '/').split('/');
    const idx = parts.findIndex(p => p.toLowerCase() === 'campaigns');
    if (idx !== -1 && idx + 2 < parts.length) {
      options.project = parts[idx + 1];
      options.campaign = parts[idx + 2];
    }
  }

  const manifest = await drivePublisher.publishFileToDrive(latestFile, options);

  let msg = "📤 *Google Drive Publish Result*\n\n";
  msg += "📄 *File:* `" + path.basename(latestFile) + "`\n";
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
