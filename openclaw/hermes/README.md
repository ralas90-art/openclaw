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
*   `hermes-inbox-schema.js` [NEW] — Validates and normalizes request payloads into Hermes-compatible structures.
*   `hermes-inbox-poller.js` [NEW] — Scans the pending inbox, creates jobs, and handles processed/rejected archives.

---

## 🧪 Running the Verification Test Harness

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

---

## 🔒 Safety & Execution Boundaries

1.  **No Automatic Dispatch**: By default, the poller registers successfully ingested request files into the queue with a status of `queued`. It does **NOT** auto-trigger execution or adapter dispatches. Manual dispatch is performed via `/hermes_dispatch <job_id>`.
2.  **No Direct Connector Execution**: Real external execution remains disabled (`realExecutionEnabled: false`). No twilio, GHL CRM, or direct external network calls are performed.
3.  **No Approvals Bypass**: Gated commands queued via the poller still require approvals (`ap_...`) and transition to `awaiting_approval` status rather than bypassing security gates.
4.  **Resilience**: The poller operates in a try-catch isolation block per file. A single malformed request file or JSON syntax error will be archived into `rejected/` and will not interrupt the processing of other valid files.

---

## 🚫 Intentionally Not Implemented (Phase H5)

The following components are defined in the design spec but are intentionally deferred to future development phases:
1.  **Triage Matching Automation**: Pattern matching workflow inputs to bot slugs dynamically (Deferred to **Phase H6**).

---

## 🚀 Next Phase: H6 — Observability & Search

The next phase will focus on index optimizations, log filtering, and visual execution traces.
