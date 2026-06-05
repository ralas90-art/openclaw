# OpenClaw Hermes Orchestrator

Hermes is the orchestration and queue triaging component of the OpenClaw ecosystem.

---

## 📂 Directory Contents

*   `HERMES.md` — Core design specification, lifecycle, data models, and roadmap.
*   `hermes-job-schema.js` — Validates job structure, inputs, statuses, and formats unique Job IDs.
*   `hermes-queue-store.js` — Atomic JSON database reading/writing helper mapping to `openclaw/hermes/data/hermes-queue.json`.
*   `hermes-dedupe.js` — Duplicate matching logic comparing active job signatures.
*   `hermes-queue-engine.js` — Engine interface supplying job CRUD, lifecycles, and transitions.
*   `runtime-dispatcher-adapter.js` [NEW] — Dispatches jobs to the frozen Runtime Orchestration API, mapping parameters and managing gated approvals.

---

## 🧪 Running the Verification Test Harness

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

## 🚫 Intentionally Not Implemented (Phase H3)

The following components are defined in the design spec but are intentionally deferred to future development phases:
1.  **Incoming Trigger Daemon (Inbox Poller)**: Monitoring `openclaw/inbox/` for new Telegram request files (Deferred to **Phase H5**).
2.  **Telegram Command Handlers (`/hermes_`)**: Managing status queries, cancellation triggers, and retry operations (Deferred to **Phase H4**).

---

## 🚀 Next Phase: H4 — Telegram Controls

The next phase will implement the `/hermes_` Telegram handlers, exposing queue administration controls to operators.
