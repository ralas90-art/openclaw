# OpenClaw Hermes Orchestrator

Hermes is the orchestration and queue triaging component of the OpenClaw ecosystem.

---

## 📂 Directory Contents

*   `HERMES.md` — Core design specification, lifecycle, data models, and roadmap.
*   `hermes-job-schema.js` [NEW] — Validates job structure, inputs, statuses, and formats unique Job IDs.
*   `hermes-queue-store.js` [NEW] — Atomic JSON database reading/writing helper mapping to `openclaw/hermes/data/hermes-queue.json`.
*   `hermes-dedupe.js` [NEW] — Duplicate matching logic comparing active job signatures.
*   `hermes-queue-engine.js` [NEW] — Engine interface supplying job CRUD, lifecycles, and transitions.

---

## 🧪 Running the Verification Test Harness

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

## 🚫 Intentionally Not Implemented (Phase H2)

The following components are defined in the design spec but are intentionally deferred to future development phases:
1.  **Incoming Trigger Daemon (Inbox Poller)**: Monitoring `openclaw/inbox/` for new Telegram request files.
2.  **Runtime Dispatcher Adapter (`runtime-dispatcher-adapter.js`)**: Performing actual dispatch calls to `runtime-orchestration-api.js` (Deferred to **Phase H3**).
3.  **Telegram Command Handlers (`/hermes_`)**: Managing status queries, cancellation triggers, and retry operations (Deferred to **Phase H4**).

---

## 🚀 Next Phase: H3 — Runtime Dispatcher Adapter

The immediate next phase will implement `openclaw/hermes/runtime-dispatcher-adapter.js`, bridging the Hermes lifecycle manager with the deterministic Bot execution core.
