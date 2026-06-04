# OpenClaw Runtime Executor v1.4 — Operational Diagnostics Walkthrough

## Overview
OpenClaw Runtime Executor v1.4 adds lightweight operational diagnostics so OpenClaw can track runtime usage, success/failure trends, recent sanitized errors, and runtime configuration from Telegram. This enables better observability before introducing queue orchestration, Hermes, or more runtime bots.

---

## 🛠️ Diagnostics Commands Added
Three new admin-only Telegram commands (along with space-collapsed variants) have been added:

1. **/run_metrics**
   - Shows runtime usage metrics including total executions, run_bot success/failures, run_publish success/failures, latest success/failure timestamps, most used bot, and total Drive publish successes/failures.
   - Suggests next commands: `/run_status`, `/run_errors`, and `/run_history`.

2. **/run_errors**
   - Displays the last 5 sanitized runtime errors including timestamps, commands, bot slugs, categories, and clean error messages.
   - Sanitizes and removes all stack traces, API keys, credentials, and absolute system paths.
   - Returns a friendly message if no errors exist: `"No recent runtime errors found."`

3. **/run_config**
   - Displays safe runtime configuration information such as runtime status, model provider, default model, approved runtime bots, publishing states, outbox file counts, a safe result directory label, and list of enabled commands.
   - Does NOT expose any API keys, environment variables, absolute Railway paths, or Windows absolute system paths.

---

## 📂 Files Created or Modified

### New Logging Infrastructure
- **[openclaw/runtime/runtime-logger.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-logger.js)**
  - Implements safe, non-blocking append-only JSON Lines logger that writes execution logs to `openclaw/runtime/logs/runtime-events.jsonl`.
- **[openclaw/runtime/runtime-metrics.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-metrics.js)**
  - Aggregates logs to compute metrics, slices the last 5 errors, and filters configuration variables to generate a safe view. Includes an error sanitization helper that masks keys (`sk-***` / `AIzaSy***`), strips call stacks, and replaces local absolute paths with `openclaw/outbox/`.

### Integrations & Updates
- **[openclaw/runtime/runtime-executor.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-executor.js)**
  - Logs bot execution successes, and captures sanitized error details on failure.
- **[openclaw/integrations/google-drive-publisher/drive-publisher.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/integrations/google-drive-publisher/drive-publisher.js)**
  - Logs Drive publish events (both manual and controlled run+publish flow) and records duplicate detection events.
- **[interfaces/telegram/handlers.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/interfaces/telegram/handlers.js)**
  - Routes `/run_metrics`, `/run_errors`, and `/run_config`, protects them with authorization checks, updates the `/help` response, and hooks the logger into the `/run_publish` execution and publication flow.

---

## 🧪 Verification & Automated Test Results
All 45 automated tests (including 29 baseline tests and 16 new diagnostic/observability tests) are passing perfectly:

```
🧪 Starting OpenClaw Runtime Executor Test Suite...

✅ Test PASSED: Test 1: Config parses environment variables and allowed chat IDs correctly
✅ Test PASSED: Test 2: Admin validation rejects unauthorized chat ID
...
✅ Test PASSED: Test 24: Duplicate detection returns existing Drive link for same file
✅ Test PASSED: Test 25: Drive failure returns clean fallback message with generated filename
✅ Test PASSED: Test 26: /run_bot remains manual-only — no auto-publish triggered
✅ Test PASSED: Test 27: /run_status, /run_latest, and /run_history still work after v1.3 changes
✅ Test PASSED: Test 28: Existing Drive publisher publishPendingToDrive still works independently of /run_publish
✅ Test PASSED: Test 29: Concurrency — /run_publish publishes only the file it generated, not a concurrent pending file
✅ Test PASSED: Test 30: /run_metrics returns zero-state gracefully when no log file exists
✅ Test PASSED: Test 31: /run_errors returns no-errors message when no error events exist
✅ Test PASSED: Test 32: /run_config returns safe config without secrets
✅ Test PASSED: Test 33: /run_bot success writes a runtime success event
✅ Test PASSED: Test 34: /run_bot failure writes a sanitized failure event
✅ Test PASSED: Test 35: /run_publish success writes execution and publish status
✅ Test PASSED: Test 36: /run_publish failure writes sanitized failure event
✅ Test PASSED: Test 37: /run_metrics aggregates success/failure counts correctly
✅ Test PASSED: Test 38: /run_errors returns only the last 5 errors
✅ Test PASSED: Test 39: /run_errors does not expose stack traces, API keys, env values, or absolute paths
✅ Test PASSED: Test 40: /run_config does not expose API keys or raw env values
✅ Test PASSED: Test 41: Unauthorized users cannot access /run_metrics, /run_errors, or /run_config
✅ Test PASSED: Test 42: Existing /run_bot manual behavior still works
✅ Test PASSED: Test 43: Existing /run_publish exact-file behavior still works
✅ Test PASSED: Test 44: Existing /run_status, /run_latest, and /run_history still work
✅ Test PASSED: Test 45: Existing Drive publisher tests still pass

📊 Runtime Executor Tests (v1.4): 45 | ✅ Passed: 45 | ❌ Failed: 0
```

Both secondary test suites remain 100% green:
- `node testing/test-activated-bots.js` (ALL BOT ROUTING & STATUS TESTS PASSED)
- `node scratch/test-drive-publisher.js` (12/12 PASSED)

---

## 🔮 Recommendation for v1.5
Before introducing the full queueing orchestrator and Hermes, we recommend:
1. **Adding Log Rotation:** Since `runtime-events.jsonl` is append-only, add a size-based log rotator (e.g. limit file size to 5MB and keep 3 backups) to ensure resource safety.
2. **Category-based Alerts:** Integrate direct Telegram admin notifications for critical error categories (e.g., `google_drive_error`, `credentials_missing`) immediately when they happen.
