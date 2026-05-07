const express = require('express');
const dotenv = require('dotenv');
const { processEvents } = require('./core/events/runtime');

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Background Loop Logic
let isProcessing = false;

async function runEventLoop() {
  if (isProcessing) return;
  
  isProcessing = true;
  console.log('⏱️ [Loop] Starting event processing cycle...');
  
  try {
    await processEvents();
    console.log('✅ [Loop] Cycle completed.');
  } catch (err) {
    console.error('❌ [Loop] Error in background cycle:', err.message);
  } finally {
    isProcessing = false;
  }
}

// Enable loop based on environment
const shouldRunLoop = process.env.NODE_ENV === 'production' || process.env.ENABLE_EVENT_LOOP === 'true';

if (shouldRunLoop) {
  console.log('⚙️ [System] Background Event Loop ENABLED (30s interval)');
  setInterval(runEventLoop, 30000);
} else {
  console.log('⚠️ [System] Background Event Loop DISABLED');
}

/**
 * TELEGRAM WEBHOOK ROUTE
 * Entry point for Telegram Bot API updates.
 */
app.post('/telegram/webhook', (req, res) => {
  console.log('[WEBHOOK HIT]');
  const update = req.body;

  // Log FULL body for debugging Chat ID issues
  console.log('[BODY RECEIVED]', JSON.stringify(update, null, 2));

  // Legacy field logging for backward compatibility
  if (update.message) {
    console.log('📬 [Telegram] From:', update.message.from?.username || 'unknown');
    console.log('💬 [Telegram] Text:', update.message.text);
  }

  res.status(200).json({ ok: true, webhook: "received" });
});

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    loop_active: shouldRunLoop
  });
});

// Runtime Diagnostics (Safe verification of env vars)
app.get('/diag', (req, res) => {
  const vars = [
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NODE_ENV',
    'ENABLE_EVENT_LOOP'
  ];
  
  const status = {};
  vars.forEach(v => {
    status[v] = process.env[v] ? 'PRESENT' : 'MISSING';
  });

  res.json({
    engine: 'Cresca OS Runtime V1',
    port: port,
    env: status,
    timestamp: new Date().toISOString(),
    is_processing: isProcessing
  });
});

// Root route
app.get('/', (req, res) => {
  res.send('Cresca OS Infrastructure is live.');
});

app.listen(port, '0.0.0.0', () => {
  console.log('-------------------------------------------');
  console.log(`🚀 Cresca OS Server started!`);
  console.log(`📡 Port: ${port}`);
  console.log(`🏥 Health: /health`);
  console.log(`🔍 Diagnostics: /diag`);
  console.log(`🔄 Loop: ${shouldRunLoop ? 'ON' : 'OFF'}`);
  console.log('-------------------------------------------');
});
