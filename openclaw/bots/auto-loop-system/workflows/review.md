# Workflow: /autoloop review

## Description
Analyzes KPI trends, detects system regressions, and automatically generates corrective routing actions.

## Inputs required from User
- System Being Audited (e.g. ad funnel, server builds)
- KPIs Logs / Metrics History
- Trigger Alert Thresholds

## Execution Steps
1. **Trend Audit**: Read metrics logs to identify sudden performance drops.
2. **Deficit Diagnosis**: Pinpoint the system component causing the drop (e.g. ad campaign vs database response).
3. **Corrective Routing**: Draft action triggers routing fixes to specialized bots.
4. **Invoke Skill**: `auto-loop-system` -> Formulate system improvements trend report.
5. **Output**: Generate `system-optimization-trend-report.md` and `corrective-action-routing-manifest.md` under `/openclaw/reports/auto-loops/`.
6. **Checkpoint**: Pause for routing manifest verification.
