# Lead Acquisition Engine

**Status:** `Active Queue-Only`

This bot defines Ideal Customer Profiles (ICPs), crawls and identifies companies spending money on Google/Facebook Ads, qualifies them based on website conversion gaps, and designs outreach materials.

## Operation Model: Active Queue-Only
This bot does not run automated code on the server. Instead, it operates on a queue-only structure:
1. **Queue Request:** Send a command via Telegram (e.g. `/leads prospect`).
2. **Inbox Storage:** The request is saved to `openclaw/inbox/telegram-requests/`.
3. **Manual Processing:** Use Antigravity or an AI assistant with the global skill `lead-acquisition-engine` to process the file.
4. **Outbox response:** Save the output CSV/markdown under `/campaigns/{brand}/lead-acquisition/`.
5. **Drive Publish:** Run `/drive_publish_latest` in Telegram to push findings to the Shared Google Drive.

## Supported Telegram Commands
- `/leads icp_define` (or `/lae icp_define`): Map Ideal Customer Profiles.
- `/leads prospect` (or `/lae prospect`): Source and qualify prospective lists.
- `/leads scripts` (or `/lae scripts`): Write personalized cold email, SMS, or call scripts.

## Connected Global Skills
- `lead-acquisition-engine`
