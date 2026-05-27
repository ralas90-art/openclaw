# System Master Orchestrator

**Status:** `Active Queue-Only`

This bot coordinates technical architecture blueprints, deployment pipelines, lint/TS validation sweeps, and code maintenance across OpenClaw.

## Operation Model: Active Queue-Only
This bot does not run automated code on the server. Instead, it operates on a queue-only structure:
1. **Queue Request:** Send a command via Telegram (e.g. `/sys build_app`).
2. **Inbox Storage:** The request is saved to `openclaw/inbox/telegram-requests/`.
3. **Manual Processing:** Use Antigravity or an AI assistant with the global skills (like `repo-fix-pr-deploy` or `publish-github-vercel`) to process the file.
4. **Outbox response:** Save the output markdown/json under `openclaw/reports/system-builds/`.
5. **Drive Publish:** Run `/drive_publish_latest` in Telegram to push findings to the Shared Google Drive.

## Supported Telegram Commands
- `/sys build_app` (or `/smo build_app`): Plan frontend layout, pages, and components.
- `/sys deploy` (or `/smo deploy`): Coordinate GitHub branch merges and staging deployments.
- `/sys fix_bug` (or `/smo fix_bug`): Trace runtime errors, warnings, and CORS bugs.

## Connected Global Skills
- `repo-fix-pr-deploy`
- `brand-ux-consistency-auditor`
- `service-delivery-systemizer`
- `publish-github-vercel`
