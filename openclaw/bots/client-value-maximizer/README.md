# Client Value Maximizer

**Status:** `Active Queue-Only`

This bot identifies upsell/cross-sell models, structures client intake/onboarding paths, maps database reactivation sequences, and plans referral incentives.

## Operation Model: Active Queue-Only
This bot does not run automated code on the server. Instead, it operates on a queue-only structure:
1. **Queue Request:** Send a command via Telegram (e.g. `/client_value upsell`).
2. **Inbox Storage:** The request is saved to `openclaw/inbox/telegram-requests/`.
3. **Manual Processing:** Use Antigravity or an AI assistant with the global skills (like `client-value-maximizer` or `client-onboarding-system-builder`) to process the file.
4. **Outbox response:** Save the output reports under `/campaigns/{brand}/client-value/`.
5. **Drive Publish:** Run `/drive_publish_latest` in Telegram to push findings to the Shared Google Drive.

## Supported Telegram Commands
- `/client_value upsell` (or `/cvm upsell`): Plan backend packaging, pricing tiers, and loyalty additions.
- `/client_value reactivate` (or `/cvm reactivate`): Build SMS/Email templates for database reactivation.
- `/client_value referral` (or `/cvm referral`): Outline trigger events and incentives for referral loops.

## Connected Global Skills
- `client-value-maximizer`
- `client-onboarding-system-builder`
- `service-delivery-systemizer`
