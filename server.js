require('dotenv').config();
// Trigger Railway rebuild

// Sanitize environment variables to strip accidental quotes and whitespace
['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_ALLOWED_USER_IDS', 'TELEGRAM_ALLOWED_CHAT_IDS'].forEach(key => {
  if (process.env[key]) {
    process.env[key] = process.env[key].replace(/^["']|["']$/g, '').trim();
  }
});

// Sanitize and validate PUBLIC_URL to ensure it contains only the base domain and protocol (no subpaths)
if (process.env.PUBLIC_URL) {
  let cleaned = process.env.PUBLIC_URL.replace(/^["']|["']$/g, '').trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(cleaned);
    if (parsed.pathname !== '/' && parsed.pathname !== '') {
      console.error(`❌ [PUBLIC_URL Check] Rejected PUBLIC_URL "${process.env.PUBLIC_URL}" because it contains a path suffix: "${parsed.pathname}". PUBLIC_URL must be the base domain only!`);
      delete process.env.PUBLIC_URL;
    } else {
      process.env.PUBLIC_URL = cleaned;
    }
  } catch (err) {
    console.error(`❌ [PUBLIC_URL Check] Rejected PUBLIC_URL "${process.env.PUBLIC_URL}" because it is not a valid URL: ${err.message}`);
    delete process.env.PUBLIC_URL;
  }
}



// Conservative sanitization for INTERNAL_ADMIN_TOKEN
if (process.env.INTERNAL_ADMIN_TOKEN) {
  let t = process.env.INTERNAL_ADMIN_TOKEN.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    t = t.substring(1, t.length - 1);
  } else if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) {
    t = t.substring(1, t.length - 1);
  }
  process.env.INTERNAL_ADMIN_TOKEN = t;
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const { supabase } = require('./lib/supabase');
const runtimeGovernor = require('./core/coordination/runtimeGovernor');
const { replayEvent } = require('./core/replay/replayManager');
const runtimePreflight = require('./core/runtime/runtimePreflight');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ==========================================
// RUNTIME BOOT LOGIC
// ==========================================
console.log('🔄 Initializing Cresca OS Runtime...');
// 1. Autonomous Runtime Loop & Mesh
require('./core/mesh/agentMesh');

// 2. Event Handlers Registration
require('./core/events/handlers/crmSyncRequested');
try { require('./core/queue/deadLetter'); } catch (e) { /* ignore if missing */ }

// 3. Telegram Integration Initialization
const { handleCommand } = require('./interfaces/telegram/handlers');

// Centralized, robust Telegram message sender with double fallback
async function sendTelegramMessage(botToken, chatId, reply, timeoutMs = 10000) {
  if (!botToken || !chatId || !reply) return false;

  const hasMarkup = (reply instanceof String || typeof reply === 'object') && reply.reply_markup;
  
  // Attempt 1: Markdown + reply_markup (if present)
  const payload1 = hasMarkup ? {
    chat_id: chatId,
    text: String(reply),
    reply_markup: reply.reply_markup,
    parse_mode: 'Markdown'
  } : {
    chat_id: chatId,
    text: String(reply),
    parse_mode: 'Markdown'
  };

  try {
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, payload1, { timeout: timeoutMs });
    return true;
  } catch (errMarkdown) {
    console.warn(`[Telegram Webhook] Failed to send message with Markdown parsing: ${errMarkdown.message}. Retrying as plain text...`);
    
    // Attempt 2: Plain Text + reply_markup (if present)
    const payload2 = hasMarkup ? {
      chat_id: chatId,
      text: String(reply),
      reply_markup: reply.reply_markup
    } : {
      chat_id: chatId,
      text: String(reply)
    };

    try {
      await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, payload2, { timeout: timeoutMs });
      return true;
    } catch (errPlainMarkup) {
      if (hasMarkup) {
        console.warn(`[Telegram Webhook] Failed to send plain text message with reply_markup: ${errPlainMarkup.message}. Retrying as pure plain text...`);
        
        // Attempt 3: Pure Plain Text (no reply_markup)
        try {
          await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            chat_id: chatId,
            text: String(reply)
          }, { timeout: timeoutMs });
          return true;
        } catch (errPure) {
          console.error(`[Telegram Webhook Error] Failed to send pure plain text message: ${errPure.message}`);
        }
      } else {
        console.error(`[Telegram Webhook Error] Failed to send plain text message: ${errPlainMarkup.message}`);
      }
    }
  }
  return false;
}

app.post('/webhook/telegram', async (req, res) => {
  try {
    console.log('[Telegram Webhook] telegram_webhook_received=true');

    // Security 1: Verify Webhook Secret
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const providedSecret = req.headers['x-telegram-bot-api-secret-token'];
    const hasSecretHeader = !!providedSecret;
    const secretHeaderMatches = expectedSecret ? (providedSecret === expectedSecret) : true;

    console.log(`[Telegram Webhook] has_secret_header=${hasSecretHeader}`);
    console.log(`[Telegram Webhook] secret_header_matches=${secretHeaderMatches}`);

    if (expectedSecret && !secretHeaderMatches) {
      console.warn('[Telegram Webhook] Webhook secret token validation failed.');
      return res.status(401).send('Unauthorized webhook secret');
    }

    // A. Handle Callback Query
    const callbackQuery = req.body.callback_query;
    if (callbackQuery) {
      console.log('[Telegram Webhook] callback_query_received=true');
      res.sendStatus(200);

      setImmediate(async () => {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (botToken) {
          try {
            await axios.post(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
              callback_query_id: callbackQuery.id
            }, { timeout: 5000 });
          } catch (e) {
            console.error('[Telegram Webhook Callback Answer Error]', e.message);
          }
        }

        const { handleCallback } = require('./interfaces/telegram/hermes-callback-router');
        let reply;
        try {
          reply = await handleCallback(callbackQuery);
        } catch (err) {
          console.error('[Telegram Webhook Callback Error]', err);
          reply = `❌ Error processing callback query: ${err.message}`;
        }

        const chatId = callbackQuery.message?.chat?.id;
        if (reply && chatId && botToken) {
          await sendTelegramMessage(botToken, chatId, reply);
        }
      });
      return;
    }

    const message = req.body.message;
    if (message && message.text) {
      console.log('[Telegram Webhook] update_received=true');
      const tmpChatId = message.chat?.id?.toString();
      console.log('[Telegram Webhook] chat_id_present=' + !!tmpChatId);
      const tmpIsCommand = message.text.startsWith('/');
      console.log('[Telegram Webhook] text_starts_with_slash=' + tmpIsCommand);
      const isCommand = message.text.startsWith('/');
      const commandDetected = isCommand ? message.text.split('\n')[0].split(' ')[0] : 'none';
      console.log(`[Telegram Webhook] command_detected=${commandDetected}`);

      const userId = message.from?.id?.toString();
      const chatId = message.chat?.id?.toString();
      console.log(`[Telegram Webhook] telegram_user_id=${userId || 'unknown'}`);
      console.log(`[Telegram Webhook] telegram_chat_id=${chatId || 'unknown'}`);

      // Security 2: Verify Allowed User IDs with Fail-Closed Production Rules
      const allowedUsersStr = process.env.TELEGRAM_ALLOWED_USER_IDS;
      const allowedUsers = allowedUsersStr ? allowedUsersStr.split(',').map(s => s.trim()) : [];
      const nodeEnv = process.env.NODE_ENV;
      const unrestrictedDevMode = process.env.TELEGRAM_ALLOW_UNRESTRICTED_DEV_MODE === 'true';

      let userAuthorized = false;

      if (allowedUsers.length > 0) {
        userAuthorized = allowedUsers.includes(userId);
      } else {
        if (nodeEnv === 'production') {
          userAuthorized = false;
          console.error('❌ [Telegram Webhook] Production authorization failed: TELEGRAM_ALLOWED_USER_IDS is not configured.');
        } else {
          if (unrestrictedDevMode) {
            userAuthorized = true;
            console.warn('⚠️ [Telegram Webhook] Warning: Access granted via TELEGRAM_ALLOW_UNRESTRICTED_DEV_MODE in non-production environment.');
          } else {
            userAuthorized = false;
            console.warn('❌ [Telegram Webhook] Access denied: Allowed users empty. Set TELEGRAM_ALLOW_UNRESTRICTED_DEV_MODE=true to allow dev testing.');
          }
        }
      }

      console.log(`[Telegram Webhook] user_authorized=${userAuthorized}`);

      if (!userAuthorized) {
        return res.status(403).send('User not authorized');
      }

      // Security 3: Verify Allowed Chat IDs (only if configured)
      const allowedChatsStr = process.env.TELEGRAM_ALLOWED_CHAT_IDS;
      const allowedChats = allowedChatsStr ? allowedChatsStr.split(',').map(s => s.trim()) : [];
      const chatAuthorized = allowedChats.length === 0 || allowedChats.includes(chatId);

      console.log(`[Telegram Webhook] chat_authorized=${chatAuthorized}`);

      if (!chatAuthorized) {
        return res.status(403).send('Chat not authorized');
      }

      // B. Intercept guided workflow text inputs first!
      const { handleSessionTextMessage } = require('./interfaces/telegram/hermes-ux-menu');
      const sessionIntercept = await handleSessionTextMessage(message);
      if (sessionIntercept) {
        console.log('[Telegram Webhook] route_selected=menu_session');
        res.sendStatus(200);
        setImmediate(async () => {
          const botToken = process.env.TELEGRAM_BOT_TOKEN;
          if (botToken && chatId) {
            console.log('[Telegram Webhook] telegram_send_attempted=true');
            const replySent = await sendTelegramMessage(botToken, chatId, sessionIntercept);
            console.log('[Telegram Webhook] telegram_send_success=' + !!replySent);
          }
        });
        return;
      }

      // C. Normal slash command processing
      if (message.text) {
        console.log('[Telegram Webhook] route_selected=' + (message.text.startsWith('/') ? 'slash_command' : 'nl_router'));
        // ✅ ACK Telegram immediately
        res.sendStatus(200);

        setImmediate(async () => {
          const SEND_TIMEOUT_MS = 10000;
          let reply;
          let handlerResultStatus = 'success';
          try {
            const { dispatchCommand } = require('./interfaces/telegram/handlers');
            const dispatchRes = await dispatchCommand(message.text, message);
            reply = dispatchRes ? dispatchRes.text : null;
          } catch (handlerErr) {
            console.error(`[Telegram Webhook Error] Command handler failed: ${handlerErr.message}`);
            handlerResultStatus = 'error';
            reply = `❌ Internal error processing command.`;
          }

          console.log(`[Telegram Webhook] handler_result_status=${handlerResultStatus}`);
          console.log('[Telegram Webhook] response_generated=' + !!reply);

          if (reply && chatId) {
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            if (botToken) {
              console.log('[Telegram Webhook] telegram_send_attempted=true');
              const replySent = await sendTelegramMessage(botToken, chatId, reply, SEND_TIMEOUT_MS);
              console.log('[Telegram Webhook] telegram_send_success=' + !!replySent);
              console.log(`[Telegram Webhook] reply_sent=${replySent}`);
            } else {
              console.warn('[Telegram Webhook Warning] TELEGRAM_BOT_TOKEN is not configured. Reply sent: false');
              console.log('[Telegram Webhook] reply_sent=false');
            }
          } else {
            console.log('[Telegram Webhook] reply_sent=false');
          }
        }); // end setImmediate
      } else {
        // Not a command and not intercepted by active session, just ACK
        res.sendStatus(200);
      }
    } else {
      // For non-command messages or non-message updates, ack immediately
      if (!res.headersSent) res.sendStatus(200);
    }
  } catch (err) {
    console.error('[Telegram Error]', err.message);
    if (!res.headersSent) res.sendStatus(500);
  }
});

// 1. Internal Admin Auth Guard for /api/admin routes (requires valid srv_sess_... token)
async function requireInternalAdminAuthToken(req, res, next) {
  const authHeader = req.headers.authorization;
  let token = authHeader && authHeader.split(' ')[1];
  if (!token && req.headers['x-admin-token']) {
    token = req.headers['x-admin-token'];
  }
  
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (token.startsWith('srv_sess_')) {
    try {
      const { validateSessionToken } = require('./jarvis/auth-tickets');
      const sessionRes = await validateSessionToken(token);
      if (sessionRes && sessionRes.valid) {
        req.sessionMetadata = sessionRes.metadata;
        return next();
      }
    } catch (_) {}
  }

  return res.status(401).json({ error: "Unauthorized" });
}

// ==========================================
// ADMIN API ROUTES
// ==========================================

const apiRouter = express.Router();
apiRouter.use(requireInternalAdminAuthToken);

apiRouter.get('/runtime/status', async (req, res) => {
  let dbStatus = 'Offline';
  let healthScore = 0;
  
  if (supabase) {
    dbStatus = 'Connected';
    const { data: metrics } = await supabase.from('sync_metrics').select('metric_name, value').limit(100);
    if (metrics && metrics.length > 0) {
      const success = metrics.filter(m => m.metric_name === 'sync_success').length;
      const failure = metrics.filter(m => m.metric_name === 'sync_failure').length;
      healthScore = success > 0 ? Math.round((success / (success + failure)) * 100) : 0;
    }
  }

  res.json({
    status: "ACTIVE",
    health_score: healthScore,
    database: dbStatus,
    safe_mode: runtimeGovernor.isSafeMode()
  });
});

apiRouter.get('/runtime/safe-mode', (req, res) => {
  res.json({
    safe_mode: runtimeGovernor.isSafeMode(),
    reason: runtimeGovernor.reason || null
  });
});

apiRouter.post('/runtime/safe-mode', async (req, res) => {
  const { action, reason, confirm } = req.body;
  if (!confirm) return res.status(400).json({ error: "Confirmation required" });
  
  if (action === 'enter') {
    await runtimeGovernor.enterSafeMode(reason || 'Manual via Admin', true);
  } else if (action === 'exit') {
    await runtimeGovernor.exitSafeMode(true);
  } else {
    return res.status(400).json({ error: "Invalid action" });
  }
  
  res.json({ success: true, safe_mode: runtimeGovernor.isSafeMode() });
});

const { sanitizeError } = require('./jarvis/sanitizer');

apiRouter.get('/tenants', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "Supabase offline" });
  const { data, error } = await supabase.from('tenants').select('id, name, created_at').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: sanitizeError() });
  res.json(data);
});

apiRouter.get('/tenants/:tenantId', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "Supabase offline" });
  const { tenantId } = req.params;
  
  const { data: tenant, error: tErr } = await supabase.from('tenants').select('*').eq('id', tenantId).single();
  if (tErr) return res.status(404).json({ error: "Tenant not found" });

  const { data: connections } = await supabase.from('integration_connections').select('provider, enabled, settings, last_sync_at').eq('tenant_id', tenantId);
  
  // Mask secrets in connections
  const maskedConnections = (connections || []).map(conn => {
    const settings = conn.settings || {};
    return {
      provider: conn.provider,
      status: conn.enabled ? 'connected' : 'disabled',
      location_id: settings.location_id || null,
      credential_status: settings.access_token || settings.api_key ? 'configured' : 'missing',
      credential_preview: settings.access_token ? '••••••••' + settings.access_token.slice(-4) : (settings.api_key ? '••••••••' + settings.api_key.slice(-4) : null),
      last_sync_at: conn.last_sync_at
    };
  });

  res.json({
    tenant: {
      id: tenant.id,
      name: tenant.name,
      settings: tenant.settings,
      created_at: tenant.created_at
    },
    integrations: maskedConnections
  });
});

apiRouter.post('/tenants', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "Supabase offline" });
  const { name, provider, location_id, access_token } = req.body;
  
  // 1. Create tenant
  const { data: tenant, error: tErr } = await supabase.from('tenants').insert([{ name }]).select().single();
  if (tErr) return res.status(500).json({ error: sanitizeError() });
  
  // 2. Add connection
  if (provider) {
    const settings = { location_id };
    if (access_token) settings.access_token = access_token;
    await supabase.from('integration_connections').insert([{
      tenant_id: tenant.id,
      provider,
      settings
    }]);
  }

  // 3. Log action
  await supabase.from('admin_action_logs').insert([{
    operator: 'admin',
    action: 'create_tenant',
    tenant_id: tenant.id,
    target_type: 'tenant',
    target_id: tenant.id,
    request_payload: { name, provider, location_id, credential_provided: !!access_token },
    result: 'success'
  }]);

  res.json({ success: true, tenant_id: tenant.id });
});

apiRouter.post('/tenants/:tenantId/test-sync', async (req, res) => {
  const { tenantId } = req.params;
  const mockEvent = {
    tenant_id: tenantId,
    entity_type: 'contact',
    entity_id: 'test-' + Date.now(),
    event_type: 'crm.sync.requested',
    provider: 'ghl',
    lead_data: { name: 'Test Sync', email: 'test@example.com' }
  };

  const preflightRes = await runtimePreflight.evaluate(mockEvent);
  
  if (supabase) {
    await supabase.from('admin_action_logs').insert([{
      operator: 'admin',
      action: 'test_sync',
      tenant_id: tenantId,
      target_type: 'tenant',
      target_id: tenantId,
      request_payload: { event_type: 'crm.sync.requested' },
      result: preflightRes.action
    }]);
  }

  res.json({ success: true, preflight: preflightRes });
});

apiRouter.post('/replay', async (req, res) => {
  const { event_id, reason, confirm } = req.body;
  if (!confirm) return res.status(400).json({ error: "Confirmation required for replay" });
  if (!event_id) return res.status(400).json({ error: "event_id required" });

  try {
    await replayEvent(event_id, reason || 'Admin UI Replay');
    
    if (supabase) {
      await supabase.from('admin_action_logs').insert([{
        operator: 'admin',
        action: 'replay_event',
        target_type: 'event',
        target_id: event_id,
        request_payload: { reason },
        result: 'success'
      }]);
    }
    
    res.json({ success: true, message: `Replay initiated for event ${event_id}` });
  } catch (err) {
    res.status(500).json({ error: sanitizeError() });
  }
});

apiRouter.get('/operations/failed-syncs', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "Supabase offline" });
  const { data, error } = await supabase.from('sync_idempotency').select('*').eq('status', 'failed').order('last_seen_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: sanitizeError() });
  res.json(data || []);
});

apiRouter.get('/operations/deadletters', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "Supabase offline" });
  const { data, error } = await supabase.from('dead_letter_events').select('*').order('created_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: sanitizeError() });
  res.json(data || []);
});

apiRouter.get('/audit-logs', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "Supabase offline" });
  const { data, error } = await supabase.from('admin_action_logs').select('*').order('created_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: sanitizeError() });
  res.json(data || []);
});

apiRouter.get('/incidents', async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "Supabase offline" });
  const { data, error } = await supabase.from('runtime_incidents').select('*').order('created_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: sanitizeError() });
  res.json(data || []);
});

// Import executive report engine
let executiveWeeklyReport;
try {
  executiveWeeklyReport = require('./core/reports/executiveWeeklyReport');
} catch (err) {
  // Graceful fallback if not created yet
}

apiRouter.get('/reports/executive-weekly', async (req, res) => {
  if (!executiveWeeklyReport) return res.status(501).json({ error: "Not implemented yet" });
  const { tenant_id, start_date, end_date } = req.query;
  // if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });
  
  try {
    const report = await executiveWeeklyReport.generate(tenant_id, start_date, end_date);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: sanitizeError() });
  }
});

app.use('/api/admin', apiRouter);

// Jarvis API Routes
app.use('/api/jarvis', require('./jarvis/routes'));

// Serve static React admin UI
app.use('/admin', express.static(path.join(__dirname, 'admin-ui', 'dist')));
app.get(/^\/admin(?:\/.*)?$/, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-ui', 'dist', 'index.html'));
});

// OpenClaw Hermes Dashboard Router
const { dashboardRouter } = require('./openclaw/dashboard');
app.use('/dashboard', dashboardRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Root check
app.get('/', (req, res) => {
  res.json({ message: "Cresca OS Runtime API" });
});

const { runMigrations } = require('./jarvis/migrations');

async function bootServer() {
  try {
    if (process.env.NODE_ENV === 'production') {
      if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is missing in production.');
      }
      if (!process.env.JARVIS_ENCRYPTION_KEY) {
        throw new Error('JARVIS_ENCRYPTION_KEY is missing in production.');
      }
    }
    await runMigrations();
  } catch (err) {
    console.error('❌ [Server Boot] Critical failure during startup migrations/config checks:', err.message);
    process.exit(1);
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🛡️ Admin API secured behind INTERNAL_ADMIN_TOKEN & Session Tickets`);
    console.log(`📊 Admin UI available at /admin`);

    // Telegram Bot Startup Checks
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const allowedUsers = process.env.TELEGRAM_ALLOWED_USER_IDS;
    const nodeEnv = process.env.NODE_ENV;

    console.log('🤖 Checking Telegram bot configuration...');
    if (!botToken) {
      console.warn('⚠️ [Telegram Config Warning] TELEGRAM_BOT_TOKEN is missing. Bot replies will fail.');
    }
    if (!webhookSecret) {
      console.warn('⚠️ [Telegram Config Warning] TELEGRAM_WEBHOOK_SECRET is missing. Webhook signature check will be bypassed.');
    }
    if (!allowedUsers) {
      if (nodeEnv === 'production') {
        console.error('❌ [Telegram Config Error] TELEGRAM_ALLOWED_USER_IDS is not configured. Telegram commands are DISABLED in production (fail-closed).');
      } else {
        console.warn('⚠️ [Telegram Config Warning] TELEGRAM_ALLOWED_USER_IDS is empty. Bot running in unprotected dev mode unless restricted dev mode is configured.');
      }
    }
  });

  const { closePool } = require('./jarvis/db');
  const shutdown = async (signal) => {
    console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
    if (server) {
      await new Promise((resolve) => server.close(() => {
        console.log('✅ HTTP server closed.');
        resolve();
      }));
    }
    try {
      await closePool();
    } catch (err) {
      console.error('⚠️ Error closing database pool:', err.message);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

if (require.main === module) {
  bootServer();
}

module.exports = { app, bootServer };

