# Workflow: /weekly review

## 1. Purpose
Aggregates weekly performance stats, flags metric anomalies, and audits active business lines.

## 2. Inputs
- Week Range (e.g. May 18 - May 24)
- Core Metrics (Leads, bookings, revenue)
- Active Campaigns

## 3. Output Format
Weekly KPI scorecard comparison tables, highlighted bottleneck zone warnings, and operational suggestions list.

## 4. Connected Skills
- `weekly-command-center`

## 5. Inbox JSON Structure
```json
{
  "source": "telegram",
  "status": "queued",
  "bot": "weekly-command-center",
  "workflow": "review",
  "fields": {
    "Week Range": "May 18 - May 24",
    "Metrics": "Leads: 45, Bookings: 12, Rev: $8,500",
    "Active Campaigns": "Facebook Lead Ads"
  }
}
```

## 6. Outbox Result Location
`/openclaw/reports/weekly-summaries/weekly-performance-snapshot.md`

## 7. Google Drive Publishing Recommendation
Upload `weekly-performance-snapshot.md` and `bottlenecks-and-opportunities-report.md` to `Shared Drive/weekly-summaries/` folder.

## 8. Human-in-the-Loop Checkpoint
Verify aggregated stats against database sources before publishing weekly command center review deck.

## 9. Safety / Claim Rules
Ensure no confidential business credentials, client names, or secrets are exposed in public summaries.

## 10. Example Telegram Command
```text
/weekly review
Week Range: May 18 - May 24
Metrics: Leads: 45, Bookings: 12, Rev: $8,500
Active Campaigns: Facebook Lead Ads
```
