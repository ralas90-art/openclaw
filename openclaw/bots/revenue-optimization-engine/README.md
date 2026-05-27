# Revenue Optimization Engine

**Status:** `Active Queue-Only`

This bot audits sales funnels, CRM pipelines, and configurations to locate and repair revenue leaks.

## Operation Model: Active Queue-Only
This bot does not run automated code on the server. Instead, it operates on a queue-only structure:
1. **Queue Request:** Send a command via Telegram (e.g. `/rev_opt audit`).
2. **Inbox Storage:** The request is saved to `openclaw/inbox/telegram-requests/`.
3. **Manual Processing:** Use Antigravity or an AI assistant with the global skills (like `revenue-optimization-engine` or `ghl-config-auditor`) to process the file.
4. **Outbox response:** Save the output markdown/json under `/campaigns/{brand}/revenue-optimization/`.
5. **Drive Publish:** Run `/drive_publish_latest` in Telegram to push findings to the Shared Google Drive.

## Supported Telegram Commands
- `/rev_opt audit` (or `/roe audit`): Perform a step-by-step conversion and leakage audit.
- `/rev_opt speed_lead` (or `/roe speed_lead`): Map out immediate multi-channel triggers (SMS + Email) to reduce time-to-contact.

## Connected Global Skills
- `revenue-optimization-engine`
- `ghl-config-auditor`
- `ghl-revenue-automation-builder`
