# Workflow: /autoloop review

## 1. Purpose
Analyzes KPI trends, detects system regressions, and automatically generates corrective routing actions.

## 2. Inputs
- System Being Audited (e.g. ad funnel, server builds)
- KPIs Logs / Metrics History
- Trigger Alert Thresholds

## 3. Output Format
Metric delta tables, anomaly flags, and corrective routing actions manifest files.

## 4. Connected Skills
- `auto-loop-system`

## 5. Inbox JSON Structure
```json
{
  "source": "telegram",
  "status": "queued",
  "bot": "auto-loop-system",
  "workflow": "review",
  "fields": {
    "System Audited": "ad funnel",
    "KPIs Logs": "CPA: $45 -> $60, Conversion: 3% -> 2%",
    "Alert Thresholds": "CPA increase > 20%"
  }
}
```

## 6. Outbox Result Location
`/openclaw/reports/auto-loops/system-optimization-trend-report.md`

## 7. Google Drive Publishing Recommendation
Upload `system-optimization-trend-report.md` and `corrective-action-routing-manifest.md` to `Shared Drive/auto-loops/` folder.

## 8. Human-in-the-Loop Checkpoint
Verify the correctness of metric indicators with data analysts before dispatching bot triggers.

## 9. Safety / Claim Rules
Routing commands must contain rate-limit parameters to avoid infinite request triggers.

## 10. Example Telegram Command
```text
/autoloop review
System Audited: ad funnel
KPIs Logs: CPA: $45 -> $60, Conversion: 3% -> 2%
Alert Thresholds: CPA increase > 20%
```
