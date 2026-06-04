# OpenClaw Runtime Executor v1.9 — Permission Tiers & Command Risk Levels Walkthrough

This report details the implementation of the centralized permission system, risk-level classification tiers, and normalized gating layers in OpenClaw Runtime Executor v1.9.

---

## 🛡️ Permission Tier Structure

We introduced a command risk-level classification registry in `openclaw/runtime/runtime-permissions.js` mapping all system commands and their aliases to 5 security risk tiers:

### Tier 1 — Read Only
Inspects state without side effects, data generation, or mutations:
*   `/run_status` (alias `/runstatus`)
*   `/run_latest` (alias `/runlatest`)
*   `/run_history` (alias `/runhistory`)
*   `/run_metrics` (alias `/runmetrics`)
*   `/run_errors` (alias `/runerrors`)
*   `/run_config` (alias `/runconfig`)
*   `/run_job` (alias `/runjob`)
*   `/run_search` (alias `/runsearch`)
*   `/run_by_bot` (alias `/runbybot`)
*   `/preset_list` (alias `/presetlist`)
*   `/preset_info` (alias `/presetinfo`)
*   `/drive_latest` (alias `/drivelatest`)
*   `/run_permissions` (alias `/runpermissions`)

### Tier 2 — Generate Only
Calls LLM generation adapters and writes output files to the local outbox directory:
*   `/run_bot` (aliases `/run`, `/runtime_run`)
*   `/run_preset` (alias `/runpreset`)

### Tier 3 — Publish
Atomically uploads files to Google Drive or runs controlled publish flows:
*   `/run_publish` (aliases `/rp`, `/run_bot_publish`)
*   `/run_preset_publish` (alias `/runpresetpublish`)
*   `/drive_publish_pending` (alias `/drivepublishpending`)
*   `/drive_publish_latest` (alias `/drivepublishlatest`)
*   `/drive_republish_latest` (alias `/driverepublishlatest`)
*   `/drive_publish_file` (alias `/drivepublishfile`)
*   `/drive_publish_campaign` (alias `/drivepublishcampaign`)

### Tier 4 — Admin Maintenance
Performs indices maintenance or system configuration updates:
*   `/run_reindex` (alias `/runreindex`)

### Tier 5 — External Action Reserved
Reserved for future active scripts (outbound communications, scraping, writing to Airtable/CRM). No commands are assigned to this tier in this phase.

---

## ⚙️ Centralized Access Gating & Normalization Layer

### Command Normalization
- Added `normalizeCommand(commandText)` inside `runtime-permissions.js` to map aliases (such as `/rp`, `/run`, `/runpermissions`, `/presetlist`, `/drivepublishpending`) to their canonical command keys (such as `run_publish`, `run_bot`, `run_permissions`, `preset_list`).
- Integrated normalization before permission checks and within the telemetry logging layer (`logEvent` in `runtime-logger.js`) to ensure telemetry records log normalized keys.

### Failsafe Guardrails
- All runtime and Drive-related commands are gated via `requireCommandPermission(command, messageOrChatId)`.
- If the command is not registered, or if verification fails, the system fails closed.
- Direct gating loops using `isChatAuthorized` in `handlers.js` were replaced by clean, centralized permission gating.

### Safe /help Command
- `/help` remains safe, accessible, and does not require privileged operational access (does not expose operational details or secrets).

---

## 📄 Files Changed

*   [runtime-permissions.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-permissions.js): Normalization lookup layer, key/alias mapping, `requireCommandPermission`, and `formatPermissionDenied`.
*   [handlers.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/interfaces/telegram/handlers.js): Integrated centralized permission gating, added `/run_permissions`, updated `/help`, and modified Drive handlers to pass message signatures.
*   [runtime-executor.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-executor.js): Sanitized unauthorized log messages.
*   [runtime-presets.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-presets.js): Sanitized unauthorized preset logs.
*   [test-runtime-executor.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/scratch/test-runtime-executor.js): Appended Tests 124–150.

---

## 📊 Test Results

All 149 tests passed successfully:

> [!NOTE]
> We added 27 new tests (Tests 124–150) to verify centralized permission loading, normalization rules, and gated workflows.
> Since Test 85 is historically skipped in the suite, the total reported tests executed is 149 (with 149/149 passing successfully).

```
🧪 Starting OpenClaw Runtime Executor Test Suite...
...
✅ Test PASSED: Test 124: Permission registry loads safely
✅ Test PASSED: Test 125: Every known runtime command has a permission tier
✅ Test PASSED: Test 126: /run_permissions returns grouped command tiers
✅ Test PASSED: Test 127: /run_permissions is admin-only
✅ Test PASSED: Test 128: Read-only commands are classified correctly
✅ Test PASSED: Test 129: Generate-only commands are classified correctly
✅ Test PASSED: Test 130: Publish commands are classified correctly
✅ Test PASSED: Test 131: Admin maintenance commands are classified correctly
...
✅ Test PASSED: Test 140: Permission denied events are logged safely
✅ Test PASSED: Test 141: /run_metrics includes permission denied count
✅ Test PASSED: Test 142: /run_config shows permission tiers enabled
✅ Test PASSED: Test 147: Existing Drive publisher tests still pass
✅ Test PASSED: Test 148: Unknown runtime command permission lookup fails closed and does not execute
✅ Test PASSED: Test 149: Command aliases normalize and get canonical command names correctly
✅ Test PASSED: Test 150: /help is accessible without requiring admin privileges and is safe

📊 Runtime Executor Tests (v1.9): 149 | ✅ Passed: 149 | ❌ Failed: 0
```

*   `testing/test-activated-bots.js`: All 16 tests passed.
*   `scratch/test-drive-publisher.js`: All 12 tests passed.
