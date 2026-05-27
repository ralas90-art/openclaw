# Workflow: /weekly review

## Description
Aggregates weekly performance stats, flags metric anomalies, and audits active business lines.

## Inputs required from User
- Week Range (e.g. May 18 - May 24)
- Core Metrics (Leads, bookings, revenue)
- Active Campaigns

## Execution Steps
1. **Trend Compilation**: Match current weekly counts against prior weeks.
2. **Flag Bottlenecks**: Identify regions where transition ratios fell below target.
3. **Invoke Skill**: `weekly-command-center` -> Synthesize the weekly review dashboard.
4. **Output**: Generate `weekly-performance-snapshot.md` and `bottlenecks-and-opportunities-report.md` under `/openclaw/reports/weekly-summaries/`.
5. **Checkpoint**: Pause for weekly scorecard analysis review.
