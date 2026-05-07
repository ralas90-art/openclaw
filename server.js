const express = require('express');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

/**
 * TELEGRAM WEBHOOK ROUTE
 * Entry point for Telegram Bot API updates.
 */
app.post('/telegram/webhook', (req, res) => {
  console.log('[WEBHOOK HIT]');
  const update = req.body;

  // Detailed body logging as requested
  console.log('[BODY RECEIVED]', JSON.stringify({
    update_id: update.update_id,
    chat_id: update.message?.chat?.id,
    text: update.message?.text
  }, null, 2));

  // Log full message metadata if available (backup)
  if (update.message) {
    console.log('📬 [Telegram] From:', update.message.from?.username || 'unknown');
  }

  // Respond with custom body for verification
  res.status(200).json({ ok: true, webhook: "received" });
});

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Runtime Diagnostics (Safe verification of env vars)
app.get('/diag', (req, res) => {
  const vars = [
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NODE_ENV'
  ];
  
  const status = {};
  vars.forEach(v => {
    status[v] = process.env[v] ? 'PRESENT' : 'MISSING';
  });

  res.json({
    engine: 'Cresca OS Runtime V1',
    port: port,
    env: status,
    timestamp: new Date().toISOString()
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
  console.log(`🔗 Webhook: /telegram/webhook`);
  console.log(`🏥 Health: /health`);
  console.log(`🔍 Diagnostics: /diag`);
  console.log('-------------------------------------------');
});
