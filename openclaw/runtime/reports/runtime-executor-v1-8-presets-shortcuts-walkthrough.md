# OpenClaw Runtime Executor v1.8 — Presets & Shortcuts Walkthrough

This report documents the design, implementation, and verification of OpenClaw Runtime Executor v1.8, introducing reusable Command Presets and Telegram Shortcuts.

---

## 🛠️ Commands Added

Admin-only commands integrated into the Telegram handler:
1. **`/preset_list`** (alias `/presetlist`) — Lists all configured presets with their bot slugs, default execution modes, descriptions, and examples.
2. **`/preset_info <preset_id>`** (alias `/presetinfo`) — Displays the template, variables, safety notes, and sample run commands for a specific preset.
3. **`/run_preset <preset_id> <input>`** (alias `/runpreset`) — Renders the template using the user's input, runs the configured bot, and saves the output file (no auto-publishing).
4. **`/run_preset_publish <preset_id> <input>`** (alias `/runpresetpublish`) — Renders the template, runs the bot, and atomically publishes the exact generated markdown file to Google Drive.

---

## 📁 Files Changed / Created

- **`[NEW]`** [runtime-presets.json](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-presets.json) — JSON registry for presets metadata.
- **`[NEW]`** [runtime-presets.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-presets.js) — Utilities for parsing, executing, and publishing presets.
- **`[MODIFY]`** [result-writer.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/result-writer.js) — Injects the `## Preset Used` header into generated markdown files.
- **`[MODIFY]`** [runtime-executor.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-executor.js) — Captures preset metadata and propagates it to file writing and telemetry logging.
- **`[MODIFY]`** [runtime-job-index.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-job-index.js) — Indices `presetId` from events and scans it from markdown result headers.
- **`[MODIFY]`** [runtime-job-inspector.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-job-inspector.js) — Prints `Preset Used` in `/run_job` details.
- **`[MODIFY]`** [runtime-metrics.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-metrics.js) — Tabulates preset execution stats and exposes configuration indicators.
- **`[MODIFY]`** [handlers.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/interfaces/telegram/handlers.js) — Routes command strings to new preset handlers and updates `/help` documentation.
- **`[MODIFY]`** [test-runtime-executor.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/scratch/test-runtime-executor.js) — Sandbox presets copying and tests 99-123 integration.

---

## ⚙️ Starter Presets Included

The registry includes 8 starter presets:
1. `cleaning_lead_plan` (bot: `lead-acquisition-engine`, mode: `run_bot`)
2. `solar_lead_plan` (bot: `lead-acquisition-engine`, mode: `run_bot`)
3. `content_hooks` (bot: `content-forge`, mode: `run_bot`)
4. `short_video_prompt` (bot: `content-forge`, mode: `run_bot`)
5. `ghl_setup_plan` (bot: `revenue-master-orchestrator`, mode: `run_bot`)
6. `offer_builder` (bot: `revenue-master-orchestrator`, mode: `run_bot`)
7. `publish_content_hooks` (bot: `content-forge`, mode: `run_publish`, allowedPublish: true)
8. `publish_lead_plan` (bot: `lead-acquisition-engine`, mode: `run_publish`, allowedPublish: true)

---

## 🔒 Safety Checks

- **Admin Authentication:** Checked at both the handler and execution wrapper layers.
- **Publish Allowlist:** `/run_preset_publish` checks `allowedPublish: true` configuration, rejecting publishing requests for restricted presets.
- **Output-Only Boundary:** Prompt templates explicitly forbid calling Google Places API, scraping, GHL contact/pipeline creation, or messaging.
- **Variable Length Gating:** Safe length limits are inherited from the main execution pipeline.

---

## 🔍 Job Traceability

- Markdown results conditionally render a `## Preset Used` header listing the preset ID and name.
- Job indexes parse `## Preset Used` from files during reindexing and search queries.
- Event records in `runtime-events.jsonl` store the `presetId` field.
- `/run_job` outputs the active `Preset Used` attribute.
- `/run_search` returns match results queried by preset ID.

---

## 🧪 Test Results

All test runners executed and reported a 100% pass rate:
- **Runtime Executor Tests:** `122/122` passed. (Suite: `scratch/test-runtime-executor.js`)
- **Bot Routing and Registry Tests:** `100%` passed. (Suite: `testing/test-activated-bots.js`)
- **Google Drive Publisher Tests:** `12/12` passed. (Suite: `scratch/test-drive-publisher.js`)

---

## 🚀 Recommendation for v1.9

1. **Preset Parameter Support:** Allow optional secondary input arguments to support multi-variable template replacements.
2. **Preset Registry Mutation:** Add commands `/preset_add` and `/preset_remove` to configure templates directly from Telegram.
