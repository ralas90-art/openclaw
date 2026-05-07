const axios = require('axios');

/**
 * Telegram Client
 * Handles communication with the Telegram Bot API.
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function sendMessage(text) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('⚠️ Telegram BOT_TOKEN or CHAT_ID not configured.');
    return { success: false, error: 'Not configured' };
  }

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  
  try {
    const response = await axios.post(url, {
      chat_id: CHAT_ID,
      text: text,
      parse_mode: 'HTML'
    });

    if (response.status !== 200) {
      console.error('❌ Telegram API Error:', response.data);
      return { success: false, error: response.statusText };
    }

    console.log('📡 Telegram Alert Sent Successfully');
    return { success: true, message_id: response.data.result.message_id };

  } catch (err) {
    const errorMsg = err.response?.data?.description || err.message;
    console.error('❌ Failed to send Telegram message:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

module.exports = { sendMessage };
