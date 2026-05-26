# Phase 2 — Cresca OS Runtime Intelligence Layer

Cresca OS Phase 2 introduces an autonomous operational intelligence layer that supervisors the underlying infrastructure.

## Core Intelligence Engine

The intelligence engine enables the system to reason about its own performance and failures:

- **Event Classifier**: Categorizes incoming events (infrastructure, operation, health).
- **Priority Scorer**: Determines event urgency based on tenant tier and severity.
- **Risk Scorer**: Evaluates operational risk by analyzing trends in retries and latency.
- **Failure Classifier**: Categorizes errors into actionable types (auth, timeout, validation).
- **Execution Planner**: A deterministic, rule-based planner that decides the best course of action (retry, escalate, or move to dead letter).

## Internal Agent Runtime

Phase 2 introduces internal "Operational Supervisor" agents:

- **SyncMonitorAgent**: Tracks sync success/failure rates and generates infrastructure alerts.
- **RetryCoordinatorAgent**: Manages intelligent backoff and retry windows.
- **ProviderHealthAgent**: Monitors external API stability and transitions provider states.
- **DeadLetterAgent**: Manages failure review and automated escalation.

## Telegram Operational Control Plane

Telegram is upgraded to a command center for real-time infrastructure management:

- `/status`: High-level runtime overview.
- `/tenant [ID]`: Specific tenant health and activity report.
- `/queues`: Monitor pending and dead-letter backlogs.
- `/health`: Detailed subsystem health checks.

## Replay Framework

A formalized replay framework allows for safe recovery from transient errors:

- **Full Event Replay**: Re-emits failed events with a fresh attempt counter.
- **Idempotency Integration**: Ensures replayed events do not create duplicates.
- **Audit Trail**: Every replay is logged with the reason and user attribution.

## Operational Memory

The system maintains a historical record of infrastructure behavior:
- `agent_activity_logs`
- `provider_health_history`
- `runtime_incidents`

This data enables future reasoning over historical outages and performance patterns.
