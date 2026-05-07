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

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root route
app.get('/', (req, res) => {
  res.send('Cresca OS Infrastructure is live.');
});

app.listen(port, () => {
  console.log(`🚀 Cresca OS Server running on port ${port}`);
  console.log(`🔗 Webhook endpoint: /telegram/webhook`);
  console.log(`🏥 Health check: /health`);
});
