# Revenue Master Orchestrator

**Status:** `Active Queue-Only`

This bot coordinates strategic revenue-generating systems and monetization strategy across SeptiVolt, Cresca OS, and other OpenClaw projects.

## Operation Model: Active Queue-Only
This bot does not run automated code on the server. Instead, it operates on a queue-only structure:
1. **Queue Request:** Send a command via Telegram (e.g. `/revenue system_design`).
2. **Inbox Storage:** The request is saved to `openclaw/inbox/telegram-requests/`.
3. **Manual Processing:** Use Antigravity or an AI assistant with the global skills (like `offer-engine-builder` or `ghl-revenue-automation-builder`) to process the file.
4. **Outbox response:** Save the output markdown/json under `openclaw/outbox/telegram-responses/` or campaign sub-folders.
5. **Drive Publish:** Run `/drive_publish_latest` in Telegram to push findings to the Shared Google Drive.

## Supported Telegram Commands
- `/revenue system_design` (or `/rmo system_design`): Design overall business growth systems.
- `/revenue offer_design` (or `/rmo offer_design`): Stack offers and tiered pricing structures.
- `/revenue ghl_setup` (or `/rmo ghl_setup`): Plan GoHighLevel integrations and CRM data synchronization.

## Connected Global Skills
- `offer-engine-builder`
- `sales-process-optimizer`
- `ghl-revenue-automation-builder`
- `client-onboarding-system-builder`
