# Hermes Dry-Run Pilot Checklist & Deployment Readiness

This document outlines the validation checklist required before starting the Hermes Dry-Run Production Pilot in the live Railway/Telegram environments.

---

## 📋 Pre-Deployment Environment Checklists

### 1. Railway Environment Configuration
- [ ] **`OPENCLAW_TEST`**: Set to `false` in production env (keeps it isolated from test mock modes, but handles dry-run rules).
- [ ] **`OPENCLAW_WORKSPACE_ROOT`**: Points to the correct `/app` directory in the Railway container.
- [ ] **`TELEGRAM_BOT_TOKEN`**: Verified valid live Telegram bot credential token.
- [ ] **`TELEGRAM_ALLOWED_RUNTIME_CHAT_IDS`**: Configured with allowed superadmins IDs.
- [ ] **`OPENCLAW_ROLE_SUPER_ADMIN_CHAT_IDS`**: Matches live administrator IDs.
- [ ] **`OPENCLAW_ROLE_OPERATOR_CHAT_IDS`**: Matches operator Chat IDs.
- [ ] **`OPENCLAW_ROLE_PUBLISHER_CHAT_IDS`**: Matches publisher Chat IDs.
- [ ] **`OPENCLAW_ROLE_APPROVER_CHAT_IDS`**: Matches approver Chat IDs.
- [ ] **`OPENCLAW_ROLE_VIEWER_CHAT_IDS`**: Matches viewer Chat IDs.
- [ ] **`GOOGLE_DRIVE_LOCAL_ROOT`**: Points to the local synced directory inside the Railway container.

### 2. Telegram Webhook Status
- [ ] Verify Telegram webhook is successfully registered and listening at the Railway public server domain (e.g. `https://your-app.railway.app/webhook`).
- [ ] Check webhook diagnostic: `https://api.telegram.org/bot<TOKEN>/getWebhookInfo` reports `ok: true`.

### 3. Runtime Health Configuration
- [ ] Execute `/run_status` on the Telegram bot interface.
- [ ] Confirm `Status: ONLINE`.
- [ ] Confirm `Access Model: roles`.
- [ ] Confirm `Connector Registry: Enabled`.
- [ ] Confirm `External Actions: no` (confirming dry-run execution).

### 4. Inbox Directory Architecture
- [ ] Confirm the inbox poller folders exist in the workspace root:
  - `openclaw/inbox/telegram-requests/`
  - `openclaw/inbox/telegram-requests/processed/`
  - `openclaw/inbox/telegram-requests/rejected/`
- [ ] Verify write/read permissions on these folders for the container process.

### 5. Hermes Queue Store
- [ ] Confirm `openclaw/hermes/data/hermes-queue.json` exists or initializes cleanly as valid JSON `{}` upon start.
- [ ] Verify container write access to this path to prevent sequential EPERM lock blocks.

### 6. Connector Registry Dry-Run Checks
- [ ] Confirm Connector Registry loads: `/connector_list`.
- [ ] Assert that **every single connector** in the registry is flagged as:
  - `Status: dry_run_only`
  - `realExecutionEnabled: false`
- [ ] Verify that no live keys (Twilio, GHL, Airtable) are loaded in production `.env` files to prevent accidental executions if code freeze is ever breached.

### 7. Google Drive Publisher Safety
- [ ] Check that `GOOGLE_DRIVE_LOCAL_ROOT` is configured and read/write accessible.
- [ ] Verify that publishing remains duplicate-protected (running `/drive_publish_latest` multiple times returns existing links).

---

## 🔄 Emergency Procedures & Stop Gates

### 🚨 Emergency Stop Instructions
If any security breach, unauthorized execution, or infinite queue loop is suspected:

1. **Disable webhook routing immediately** to stop bot communication:
   ```bash
   curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url="
   ```
   *(This disconnects the bot from the Telegram API immediately).*
2. **Stop the Railway service**:
   - Go to the Railway dashboard, select the project, and click **Suspend** or **Restart** to freeze all container runtimes.
3. **Empty the Queue**:
   - Delete or empty the `openclaw/hermes/data/hermes-queue.json` database.

### ⏪ Rollback Instructions
To safely revert back to immediate execution mode and bypass the Hermes Queue Layer:

1. **Restore immediate bot command handlers**:
   - If desired, disable the `/hermes_*` routes in `interfaces/telegram/handlers.js` (unnecessary unless handlers are unstable).
2. **Stop the inbox poller**:
   - Suspend or terminate the script triggering `pollHermesInboxOnce()`.
3. **Clear requests**:
   - Empty the pending folder `openclaw/inbox/telegram-requests/`.
