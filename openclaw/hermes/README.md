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
*   `hermes-telegram-formatters.js` [NEW] — Formats job and queue details for user-facing Telegram replies.

---

## 🧪 Running the Verification Test Harness

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

1.  **Operator Controls Only**: Hermes commands act as administrative tools to visible status updates and queue events. They do not execute external integrations.
2.  **No Direct Connector Execution**: Real external execution remains disabled (`realExecutionEnabled: false`). No twilio, GHL CRM, or direct external network calls are performed.
3.  **No Approvals Bypass**: Manual dispatch or retries of gated commands still request approvals (`ap_...`) and transition to `awaiting_approval` status rather than bypassing security gates.
4.  **Role Gated**: Visibility commands require capability `read_runtime`. Cancelling, retrying, and dispatching require `operator` role or higher. Approval requires `approver` or `super_admin` role.

---

## 🚫 Intentionally Not Implemented (Phase H4)

The following components are defined in the design spec but are intentionally deferred to future development phases:
1.  **Incoming Trigger Daemon (Inbox Poller)**: Monitoring `openclaw/inbox/` for new Telegram request files (Deferred to **Phase H5**).
2.  **Triage Matching Automation**: Pattern matching workflow inputs to bot slugs dynamically (Deferred to **Phase H6**).

---

## 🚀 Next Phase: H5 — Inbox Poller Daemon

The next phase will implement the background inbox poller daemon to automate request ingestion from `openclaw/inbox/telegram-requests/`.
