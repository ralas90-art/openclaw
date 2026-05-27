# Weekly Command Center

**Status:** `Active Queue-Only`

This bot creates weekly operational reviews, compares current metric snapshots to targets, identifies team priorities, and outlines task assignments.

## Operation Model: Active Queue-Only
This bot does not run automated code on the server. Instead, it operates on a queue-only structure:
1. **Queue Request:** Send a command via Telegram (e.g. `/weekly review`).
2. **Inbox Storage:** The request is saved to `openclaw/inbox/telegram-requests/`.
3. **Manual Processing:** Use Antigravity or an AI assistant with the global skill `weekly-command-center` to process the file.
4. **Outbox response:** Save the output reports under `/openclaw/reports/weekly-summaries/`.
5. **Drive Publish:** Run `/drive_publish_latest` in Telegram to push findings to the Shared Google Drive.

## Supported Telegram Commands
- `/weekly review` (or `/wcc review`): Aggregate weekly performance snapshots and flag bottlenecks.
- `/weekly plan` (or `/wcc plan`): Generate prioritized next-actions, milestones, and task checklists.

## Connected Global Skills
- `weekly-command-center`
