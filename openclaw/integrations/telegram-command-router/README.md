# OpenClaw Telegram Command Router

The Telegram Command Router is the remote control for the OpenClaw architecture. It receives authorized commands via a Telegram webhook, parses them, checks the Bot Registry, and routes execution to the correct OpenClaw bots (like Content Forge).

## Existing Architecture
The webhook runs natively inside `server.js` at `app.post('/webhook/telegram')`.
The core logic handler lives in `interfaces/telegram/handlers.js`.

## Registry Awareness
The router reads `openclaw/bots/registry.md`. 
- **Active Bots:** Commands are routed successfully.
- **Documented Only Bots:** The router safely returns a warning that the bot is not yet active, rather than hallucinating execution.

## Inbox Fallback
Since the OpenClaw runtime executor is not yet fully connected to all bots, structured Telegram requests are currently saved as JSON payloads to:
`openclaw/inbox/telegram-requests/`

The handler replies with the next manual human-in-the-loop step required.

## Additional Documentation
- [Command Map](./command-map.md)
- [Security Model](./security.md)
- [Implementation Report](./report.md)
