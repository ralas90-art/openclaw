# Telegram Security Model

The Telegram Webhook incorporates strict security checks before any command handler is invoked.

## 1. Webhook Secret Token
The route expects the header `X-Telegram-Bot-Api-Secret-Token`.
This is verified against `process.env.TELEGRAM_WEBHOOK_SECRET`.
If the secret is missing or invalid, the request is rejected with `401 Unauthorized`.

## 2. Authorized Users
To prevent unauthorized users from interacting with the bot, the sender's Telegram User ID is verified against `process.env.TELEGRAM_ALLOWED_USER_IDS` (comma-separated).
If the ID is not in the list, the request is rejected with `403 Forbidden`.

## 3. Authorized Chats (Optional)
The chat ID is optionally verified against `process.env.TELEGRAM_ALLOWED_CHAT_IDS`.
If configured and the chat is unapproved, the request is rejected with `403 Forbidden`.

## Environment Variables
The system depends on the following variables (do not expose in logs):
```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_ALLOWED_USER_IDS=
TELEGRAM_ALLOWED_CHAT_IDS=
OPENCLAW_WORKSPACE_ROOT=
```

## Security Best Practices Enforced
- Secrets are NEVER logged to standard output.
- Payload secrets and API keys are NOT returned in Telegram text replies.
- The command router performs no arbitrary shell execution; it strictly writes structured JSON to the OpenClaw inbox.
