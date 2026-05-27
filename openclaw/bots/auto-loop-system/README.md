# Auto-Loop System

**Status:** `Active Queue-Only`

This bot sets up optimization loops, compares performance logs to thresholds, isolates bottleneck indicators, and automatically maps corrective actions to specialized skills.

## Operation Model: Active Queue-Only
This bot does not run automated code on the server. Instead, it operates on a queue-only structure:
1. **Queue Request:** Send a command via Telegram (e.g. `/autoloop review`).
2. **Inbox Storage:** The request is saved to `openclaw/inbox/telegram-requests/`.
3. **Manual Processing:** Use Antigravity or an AI assistant with the global skill `auto-loop-system` to process the file.
4. **Outbox response:** Save the output logs under `/openclaw/reports/auto-loops/`.
5. **Drive Publish:** Run `/drive_publish_latest` in Telegram to push findings to the Shared Google Drive.

## Supported Telegram Commands
- `/autoloop review` (or `/als review`): Compare performance KPIs against thresholds and draft routing actions.
- `/autoloop setup` (or `/als setup`): Initialize target metric log configurations.

## Connected Global Skills
- `auto-loop-system`
