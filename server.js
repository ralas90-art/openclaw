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
  const update = req.body;

  // Log receipt of update for monitoring
  if (update.message) {
    console.log(`📬 [Telegram] Message received from ${update.message.from?.username || 'unknown'}: "${update.message.text || '[no text]'}"`);
  }

  // TODO: Add command routing / message handling logic here

  // Respond to Telegram to acknowledge receipt
  res.status(200).send('OK');
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
