# Cresca Content & AEO Engine

**Status:** `Active Queue-Only`

This bot optimizes website copy and templates for Google (SEO), Answer Engines (AEO), and Conversion Rate Optimization.

> [!IMPORTANT]
> **Claude Copywriting Protocol:** Claude (Sonnet or Opus) MUST be used for all public-facing copy, ad pack copywriting, or landing page rewrites. Gemini is reserved for system prompts, structure validation, and metadata coding.

## Operation Model: Active Queue-Only
This bot does not run automated code on the server. Instead, it operates on a queue-only structure:
1. **Queue Request:** Send a command via Telegram (e.g. `/aeo optimize_page`).
2. **Inbox Storage:** The request is saved to `openclaw/inbox/telegram-requests/`.
3. **Manual Processing:** Use Antigravity or an AI assistant with the global skills (like `content-generation-engine` or `notebooklm-research-extractor`) to process the file (enforcing Claude for copywriting).
4. **Outbox response:** Save the output markdown/json under `/campaigns/{brand}/content-aeo/`.
5. **Drive Publish:** Run `/drive_publish_latest` in Telegram to push findings to the Shared Google Drive.

## Supported Telegram Commands
- `/aeo optimize_page` (or `/cresca_content optimize_page`): Rewrite landing pages for search engines, answer engines, and conversion.
- `/aeo faq_schema` (or `/cresca_content faq_schema`): Generate FAQ elements and JSON-LD schema configurations.

## Connected Global Skills
- `content-generation-engine`
- `notebooklm-research-extractor`
- `brand-ux-consistency-auditor`
