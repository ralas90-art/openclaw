# OpenClaw Hermes Orchestrator

Hermes is the orchestration and queue triaging component of the OpenClaw ecosystem.

## Directory Contents

*   `HERMES.md` — The Core Design Specification detailing purpose, architecture, state models, queue schemas, control plan, and implementation roadmap.
*   `runtime-dispatcher-adapter.js` [Proposed] — Future interface bridge translating Hermes queue states to direct commands on the Runtime Orchestration API.

## Design Boundaries

Hermes operates as a **queue brain** on top of the deterministic **Runtime Executor core** (`openclaw/runtime`). It acts as a client to the Runtime Orchestration API:

1.  Always call Runtime Orchestration API functions with the `source: "hermes"` parameter.
2.  Use structured JSON responses to check workflow outcomes.
3.  Support the centralized permission system by passing requesting chat IDs as the `actor` parameter.
4.  External action executions must remain local dry-runs. No real GHL writes or external scrapers should be integrated.
