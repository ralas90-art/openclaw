# OpenClaw Runtime Executor v1.5 — Job IDs & End-to-End Traceability Walkthrough

## Overview
OpenClaw Runtime Executor v1.5 introduces unique runtime job IDs and end-to-end traceability across Telegram commands, runtime event logs, generated markdown files, Google Drive publishing sync manifests, latest result details, and errors views. This makes every execution fully traceable.

---

## 🔑 Job ID Infrastructure
- **Job ID Format:** `rt_YYYYMMDD_HHMMSS_<shortRandomId>`
  - Generated using `crypto.randomBytes(3).toString('hex')`.
  - filesystem-safe and Telegram-safe.
  - Strict validation using regex: `/^rt_\d{8}_\d{6}_[a-f0-9]{6}$/`.
- **Implementation File:**
  - **[runtime-job-id.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-job-id.js)**: Handles generation and validation.
  - **[runtime-job-inspector.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-job-inspector.js)**: Performs lookup scanning on event logs (`runtime-events.jsonl`) and output markdown result files (`telegram-responses/*.md`) to construct safe consolidated traces.

---

## 🛠️ Commands Added or Updated

### 1. New Command: `/run_job <job_id>`
- Admin-only command.
- Inspects a single job trace using the job inspector, reporting the command type, target bot, execution status, generated filename, Drive publication status, Drive URL link, duration, creation timestamp, last event timestamp, and any sanitized error details.
- Suggests next command recommendations: `/run_latest`, `/run_history`, and `/drive_latest`.

### 2. Updated Commands:
- **/run_bot** & **/run_publish**
  - Generate a unique Job ID at command entry point and propagate it through the executor, output result, event log, and Google Drive publishing manifests.
  - Responses include the Job ID details and recommend `/run_job <job_id>` as the next action.
- **/run_latest**
  - Reads the generated markdown result file to extract and display the Job ID.
- **/run_history**
  - Scans files in the outbox to print the corresponding Job ID for each listed result.
- **/run_errors**
  - Includes the Job ID on each list entry if available on the event log record.
- **/help**
  - Documents the `/run_job` command.

---

## 📄 File Format Updates

### Generated Markdown Files
Output files now contain a dedicated Job ID header:
```markdown
# OpenClaw Runtime Result

## Job ID
rt_YYYYMMDD_HHMMSS_xxxxxx

...
```

### Google Drive Sync Manifests
Saved manifest JSON files inside `openclaw/outbox/google-drive-sync/` now include `jobId` metadata:
```json
{
  "source": "openclaw",
  "published_to": "google_drive",
  "status": "published",
  "publish_mode": "local",
  "local_file": "...",
  "jobId": "rt_20260604_143022_a7f3c9",
  "drive_file_id": "",
  ...
}
```

---

## 🧪 Verification & Automated Test Results
All 65 automated tests inside the test suite [test-runtime-executor.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/scratch/test-runtime-executor.js) are passing perfectly:

```
🧪 Starting OpenClaw Runtime Executor Test Suite...
...
✅ Test PASSED: Test 45: Existing Drive publisher tests still pass
✅ Test PASSED: Test 46: generateRuntimeJobId returns valid unique IDs
✅ Test PASSED: Test 47: Invalid job IDs are rejected
✅ Test PASSED: Test 48: /run_bot response includes a Job ID
✅ Test PASSED: Test 49: /run_publish response includes a Job ID
✅ Test PASSED: Test 50: Runtime markdown file includes ## Job ID
✅ Test PASSED: Test 51: runtime-events.jsonl includes jobId for successful /run_bot
✅ Test PASSED: Test 52: runtime-events.jsonl includes jobId for failed /run_bot
✅ Test PASSED: Test 53: runtime-events.jsonl includes jobId for successful /run_publish
✅ Test PASSED: Test 54: Drive publish event includes jobId
✅ Test PASSED: Test 55: Duplicate detection event includes jobId when applicable
✅ Test PASSED: Test 56: /run_job returns a valid job summary
✅ Test PASSED: Test 57: /run_job handles unknown job IDs gracefully
✅ Test PASSED: Test 58: /run_job does not expose stack traces, API keys, env values, or absolute paths
✅ Test PASSED: Test 59: /run_latest includes jobId when available
✅ Test PASSED: Test 60: /run_history includes jobId when available
✅ Test PASSED: Test 61: /run_errors includes jobId when available
✅ Test PASSED: Test 62: Existing /run_bot manual behavior still works
✅ Test PASSED: Test 63: Existing /run_publish exact-file behavior still works
✅ Test PASSED: Test 64: Existing /run_status, /run_metrics, /run_config still work
✅ Test PASSED: Test 65: Existing Drive publisher tests still pass

📊 Runtime Executor Tests (v1.5): 65 | ✅ Passed: 65 | ❌ Failed: 0
```

Secondary test suites are also 100% green:
- `node testing/test-activated-bots.js` (ALL BOT ROUTING & STATUS TESTS PASSED)
- `node scratch/test-drive-publisher.js` (12/12 PASSED)

---

## 🔮 Recommendation for v1.6
Before proceeding to Hermes or direct queue worker implementations:
1. **Index Job IDs:** When execution logs scale, searching the `.jsonl` sequentially can become slow. Introduce a simple key-value file index (e.g. `openclaw/runtime/logs/job-index.json` or local leveldown) to map `jobId` to its line offsets.
2. **Metadata sync:** Enable matching file hash comparisons to detect file renames when associating Job IDs to changed outbox filenames.
