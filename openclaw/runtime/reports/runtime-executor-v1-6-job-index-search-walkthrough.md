# OpenClaw Runtime Executor v1.6 — Job Index & Search System Walkthrough

## Overview
OpenClaw Runtime Executor v1.6 introduces a lightweight runtime job indexing and caching utility file (`openclaw/runtime/logs/runtime-job-index.json`) and adds three admin-only search commands (`/run_search`, `/run_by_bot`, `/run_reindex`) to easily retrieve, search, and inspect previous runtime jobs as the execution history scales.

---

## 🔑 Job Index Structure
The job index maps each unique `jobId` to its execution metadata.

Example `runtime-job-index.json` entry:
```json
{
  "rt_20260604_203015_abcdef": {
    "jobId": "rt_20260604_203015_abcdef",
    "command": "run_publish",
    "botSlug": "content-forge",
    "status": "success",
    "filename": "2026-06-04_20-30-15_content-forge_runtime_result.md",
    "driveLink": "https://drive.google.com/...",
    "published": true,
    "created": "2026-06-04T20:30:15.123Z",
    "lastUpdated": "2026-06-04T20:30:18.456Z",
    "summaryPreview": "Create 5 TikTok hooks for Cresca OS targeting cleaning business owners...",
    "errorCategory": null
  }
}
```

---

## 🛠️ Commands Added

### 1. `/run_search <keyword>` (alias `/runsearch`)
- Searches index fields (`jobId`, `botSlug`, `command`, `filename`, `summaryPreview`, `status`, `errorCategory`) matching the keyword (case-insensitive).
- Sanitizes and length-caps queries.
- Returns up to 5 matching jobs with summaries.
- Recommends the corresponding `/run_job <job_id>` command for deep inspection.

### 2. `/run_by_bot <bot_slug>` (alias `/runbybot`)
- Retrieves the last 5 execution logs for an approved runtime bot slug.
- Rejects unapproved bot slugs early using runtime allowlist validation.

### 3. `/run_reindex` (alias `/runreindex`)
- Scans `runtime-events.jsonl`, generated output result files inside `openclaw/outbox/telegram-responses/`, and Google Drive sync manifest files to rebuild the job index file from scratch.
- Returns execution metrics: jobs indexed, events scanned, result files scanned, errors skipped, and reindex timestamp.

---

## 📄 Files Changed
1. **[runtime-job-index.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-job-index.js) [NEW]**: Logic for load/save, incremental event updates, full reindexing scans, keyword searching, and filtering by bot.
2. **[runtime-logger.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-logger.js)**: Integrates dynamic update triggers inside `logEvent` (safe-guarded).
3. **[runtime-job-inspector.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-job-inspector.js)**: Connects `getRuntimeJob` lookup to prefer the index cache first, falling back to log parsing and file scans on miss.
4. **[runtime-metrics.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-metrics.js)**: Registers the new commands in `enabledCommands` config output.
5. **[handlers.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/interfaces/telegram/handlers.js)**: Commands routing, admin-only gating, input sanitization, and help text updates.

---

## 🛡️ Safety & Security Controls
- **Admin Gating:** All search and indexing commands validate authorization early.
- **Input Sanitization:** `/run_search` sanitizes query inputs and caps query length to 100 characters.
- **No Path/Secret Leaking:** Reindexing and searching exclude stack traces, environment variables, absolute local system paths, and API keys.

---

## 🧪 Verification & Test Results
All 85 tests inside `scratch/test-runtime-executor.js` are passing perfectly:
```
🧪 Starting OpenClaw Runtime Executor Test Suite...
...
✅ Test PASSED: Test 65: Existing Drive publisher tests still pass
✅ Test PASSED: Test 66: Job index file is created safely
✅ Test PASSED: Test 67: Job index updates after successful /run_bot
✅ Test PASSED: Test 68: Job index updates after successful /run_publish
✅ Test PASSED: Test 70: /run_search finds jobs by keyword
✅ Test PASSED: Test 71: /run_search finds jobs by bot slug
✅ Test PASSED: Test 72: /run_search finds failed jobs
✅ Test PASSED: Test 73: /run_search handles no matches gracefully
✅ Test PASSED: Test 74: /run_search sanitizes query and does not expose paths/secrets
✅ Test PASSED: Test 75: /run_by_bot returns last 5 jobs for content-forge
✅ Test PASSED: Test 76: /run_by_bot returns last 5 jobs for revenue-master-orchestrator
✅ Test PASSED: Test 77: /run_by_bot rejects unknown bot slugs
✅ Test PASSED: Test 78: /run_reindex rebuilds index from runtime-events.jsonl and result files
✅ Test PASSED: Test 79: /run_reindex handles missing logs gracefully
✅ Test PASSED: Test 80: /run_job still works using the index
✅ Test PASSED: Test 81: /run_job falls back to log scanning if index is missing
...
✅ Test PASSED: Test 85: Existing Drive publisher tests still pass

📊 Runtime Executor Tests (v1.6): 85 | ✅ Passed: 85 | ❌ Failed: 0
```
- Bot Routing Tests (`node testing/test-activated-bots.js`): **All Passed successfully**.
- Drive publisher Tests (`node scratch/test-drive-publisher.js`): **12/12 Passed successfully**.

---

## 🔮 Recommendation for v1.7
1. **Index compaction / cleanup:** Introduce a retention strategy (e.g. archiving index entries older than 30 days) to keep the JSON footprint compact under high-volume workloads.
2. **Asynchronous indexing worker:** Offload reindexing calculations to a background worker to avoid blocking the main event loop thread during high-concurrency reindexing calls.
