# OpenClaw Hermes Orchestrator

Hermes is the orchestration and queue triaging component of the OpenClaw ecosystem.

---

## 📂 Directory Contents

*   `HERMES.md` — Core design specification, lifecycle, data models, and roadmap.
*   `hermes-job-schema.js` — Validates job structure, inputs, statuses, and formats unique Job IDs.
*   `hermes-queue-store.js` — Atomic JSON database reading/writing helper mapping to `openclaw/hermes/data/hermes-queue.json`.
*   `hermes-dedupe.js` — Duplicate matching logic comparing active job signatures.
*   `hermes-queue-engine.js` — Engine interface supplying job CRUD, lifecycles, and transitions.
*   `runtime-dispatcher-adapter.js` — Dispatches jobs to the frozen Runtime Orchestration API, mapping parameters and managing gated approvals.
*   `hermes-telegram-formatters.js` — Formats job and queue details for user-facing Telegram replies.
*   `hermes-inbox-schema.js` — Validates and normalizes request payloads into Hermes-compatible structures.
*   `hermes-inbox-poller.js` — Scans the pending inbox, creates jobs, and handles processed/rejected archives.
*   `hermes-trace-formatters.js` [NEW] — Safe text/markdown formatters for traces, health logs, and failure summaries.
*   `hermes-observability.js` [NEW] — Analyzes queue health, groups bot stats, and builds trace lifecycle maps.
*   `hermes-search.js` [NEW] — Performs multi-criteria read-only filtering and pagination.

---

## 🧪 Running the Verification Test Harness

To execute the Hermes search & observability test suite, run:

```bash
node scratch/test-hermes-observability-search.js
```

To execute the Hermes inbox poller test suite, run:

```bash
node scratch/test-hermes-inbox-poller.js
```

To execute the Hermes Telegram controls test suite, run:

```bash
node scratch/test-hermes-telegram-controls.js
```

To execute the Hermes dispatcher adapter test suite, run:

```bash
node scratch/test-hermes-runtime-dispatcher-adapter.js
```

To execute the Hermes Queue Engine test suite, run:

```bash
node scratch/test-hermes-queue-engine.js
```

To run all remaining OpenClaw test suites:

```bash
node scratch/test-runtime-executor.js
node testing/test-activated-bots.js
node scratch/test-drive-publisher.js
node scratch/test-runtime-orchestration-api.js
```

---

## 📂 Inbox Folder Hierarchy

The poller structures request tracking using three dedicated folders under the workspace:

*   `openclaw/inbox/telegram-requests/` — Contains incoming pending request JSON files.
*   `openclaw/inbox/telegram-requests/processed/` — Archives successfully validated requests mapped to active queue jobs.
*   `openclaw/inbox/telegram-requests/rejected/` — Houses invalid, duplicate, or malformed request files alongside `.reject.txt` error files.

---

## 📄 Ingestion Request JSON Contract

Incoming requests must conform to the following schema format:

```json
{
  "requestId": "req_12345",
  "source": "telegram",
  "requestedBy": "10002",
  "botId": "content-forge",
  "priority": "normal",
  "inputSummary": "Create 3 compliance hooks for Solar deals",
  "metadata": {
    "originalText": "/cf copy_pack solar plan"
  },
  "force": false
}
```

*   `requestedBy` [Required] — Chat ID string representing the requesting operator.
*   `botId` [Required] — Approved bot slug (e.g. `content-forge` or `lead-acquisition-engine`).
*   `inputSummary` [Required] — Description of the task context or prompt text.
*   `priority` [Optional] — Priority level: `low`, `normal`, `high`, or `urgent` (defaults to `normal`).
*   `force` [Optional] — If `true`, bypasses active duplicate checks (defaults to `false`).

---

## 📱 Telegram Command Usage Examples

The Hermes controls command set allows administrators and operators to monitor and manage the task queue:

*   `/hermes_status` — View general health, size, and execution configuration of the Hermes queue.
*   `/hermes_queue [active|failed|completed|approval]` — Lists recent jobs in the queue, with optional status filters.
*   `/hermes_latest` — Show the latest job in the queue, including status, Job ID, and its last trace event.
*   `/hermes_read <job_id>` — Read all parameters, input, output paths, and the detailed event logs of a specific job.
*   `/hermes_cancel <job_id> [reason]` (Gated Operator) — Cancel an active job (queued/triaged/running/awaiting_approval).
*   `/hermes_retry <job_id>` (Gated Operator) — Retry a failed or blocked job. Creates a new queued run tracing back to the original.
*   `/hermes_dispatch <job_id>` (Gated Operator) — Manually trigger dispatch of a queued or approved job to the Bot Runtime.
*   `/hermes_approval` — List all jobs currently awaiting administrator approval.
*   `/hermes_approve <approval_id>` (Gated Approver) — Wrapper command that signs off on a pending publication approval via the Runtime approvals engine.
*   `/hermes_search <query>` — Full-text read-only index query searching IDs, bots, summaries, and categories.
*   `/hermes_trace <job_id>` — Detailed lifecycle trace mapping request file -> queue -> runtime job -> approvals -> Drive output link.
*   `/hermes_failures` — Lists the last 10 failed jobs in detail, redacting internal directories and code stack traces.
*   `/hermes_health` — Complete queue health diagnostics showing execution mode and status totals.

---

## 🔒 Safety & Execution Boundaries

1.  **No Automatic Dispatch**: By default, the poller registers successfully ingested request files into the queue with a status of `queued`. It does **NOT** auto-trigger execution or adapter dispatches. Manual dispatch is performed via `/hermes_dispatch <job_id>`.
2.  **No Direct Connector Execution**: Real external execution remains disabled (`realExecutionEnabled: false`). No twilio, GHL CRM, or direct external network calls are performed.
3.  **No Approvals Bypass**: Gated commands queued via the poller still require approvals (`ap_...`) and transition to `awaiting_approval` status rather than bypassing security gates.
4.  **Resilience**: The poller operates in a try-catch isolation block per file. A single malformed request file or JSON syntax error will be archived into `rejected/` and will not interrupt the processing of other valid files.

---

## 🚫 Intentionally Not Implemented (Phase H6)

The following components are defined in the design spec but are intentionally deferred to future development phases:
1.  **Triage Matching Automation**: Pattern matching workflow inputs to bot slugs dynamically (Deferred to a future pipeline integration).

## 🧪 Running Production Validation

To run the full Hermes end-to-end production validation suite, execute:

```bash
node scratch/test-hermes-production-validation.js
```

---

## 🔄 Operator Workflow Lifecycle

Once live, operators manage the task pipeline using the following flow:

1. **Request Ingestion**: Incoming trigger requests are written to the inbox folder. The inbox poller parses and triages the request file once, moving it to `processed/` and creating a Hermes job (starting in the `queued` status).
2. **Review & Inspect**: The operator reviews the new job details using `/hermes_read <job_id>` or gets a complete lifecycle map using `/hermes_trace <job_id>`.
3. **Manual Dispatch**: By default, jobs are held in the queue. The operator triggers bot execution by running `/hermes_dispatch <job_id>`.
4. **Approval Gates**: If a job performs a gated action (such as publishing templates), the dispatch transitions the job to `awaiting_approval` and stores a linked `approvalId`. The operator uses `/hermes_approve <approval_id>` (which delegates to the Runtime approvals engine) to approve execution.
5. **Monitor & Diagnosis**: The operator checks health metrics with `/hermes_health`, views recent failures with `/hermes_failures`, or searches logs using `/hermes_search <keyword>`.

> [!WARNING]
> **Safety Boundary Reminder:**
> Real external integrations (such as Twilio SMS, GHL writes, scraping, or webhooks) remain disabled. All actions operate in mock/dry-run mode, writing simulated results to outbox paths. Do NOT attempt to enable real execution in this phase.

---

## 🚀 Controlled Operations Mode — Dry-Run Production Pilot

This repository is currently running in **Controlled Operations Mode (Dry-Run Production Pilot)**. Under this mode, the system accepts commands and schedules tasks, but operates entirely within a secure simulated boundary.

### 📋 Dry-Run Pilot Instructions
1. **Pre-Deployment Auditing:** Refer to the pre-deployment checks in [hermes-dry-run-pilot-checklist.md](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/hermes/hermes-dry-run-pilot-checklist.md).
2. **Readiness Testing:** Before running in production, run the pilot readiness verification script to validate directory architectures and safety configurations:
   ```bash
   node scratch/test-hermes-dry-run-pilot-readiness.js
   ```

### 📖 Operator Command Sequence
Operators must follow the daily workflow detailed in [hermes-operator-runbook.md](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/hermes/hermes-operator-runbook.md):
1. **Health Check:** `/run_status` and `/hermes_health` (verify system is `ONLINE` and `External Actions: no`).
2. **Review Queue:** `/hermes_queue` and `/hermes_latest` (audit incoming requests).
3. **Dispatch Job:** `/hermes_dispatch <job_id>` (triggers dry-run execution or approval holds).
4. **Approve Gate:** `/hermes_approval` and `/hermes_approve <approval_id>` (role-gated approver authorization).
5. **Inspect Traces:** `/hermes_trace <job_id>` and `/hermes_search <query>` (check for successful dry-run completion).
6. **Publish Deliverables:** `/drive_publish_latest` (gated synchronization to Google Drive folders).
7. **Failure Remediation:** `/hermes_failures`, `/hermes_retry <job_id>`, or `/hermes_cancel <job_id> <reason>`.

### 🛡️ How to Verify No Live External Writes are Enabled
To inspect the environment and guarantee that no real writes to GHL CRM, Airtable, or messaging services can occur:
1. **Using Telegram Controls:**
   - Execute `/connector_list`. Verify that **every single connector** lists `realExecutionEnabled: false` and `Status: dry_run_only`.
   - Run `/run_status`. Confirm that the main status logs report `External Actions: no`.
2. **Checking Configuration Schemas:**
   - Open [connector-schemas.json](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/connector-schemas.json) and verify that all schemas declare `"realExecutionEnabled": false`.
3. **Automated Check:**
   - The pilot readiness script (`scratch/test-hermes-dry-run-pilot-readiness.js`) programmatically asserts that no live connectors are registered.

