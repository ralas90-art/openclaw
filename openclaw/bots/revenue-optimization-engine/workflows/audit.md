# Workflow: /rev_opt audit

## 1. Purpose
Performs a step-by-step conversion and leakage audit across landing pages, offers, sales pipelines, and CRM systems.

## 2. Inputs
- Brand Name
- Funnel Link (Landing page, booking page)
- Traffic Volume / Ad Spend
- Close Rate & Show Rate Metrics

## 3. Output Format
Step-by-step funnel stages breakdown, list of identified leaks, close-rate bottlenecks, and priority fixing task lists.

## 4. Connected Skills
- `revenue-optimization-engine`
- `ghl-config-auditor`

## 5. Inbox JSON Structure
```json
{
  "source": "telegram",
  "status": "queued",
  "bot": "revenue-optimization-engine",
  "workflow": "audit",
  "fields": {
    "Brand Name": "G&G Cleaning",
    "Funnel Link": "https://ggcleaningli.com/estimate",
    "Traffic Volume": "1000 visitors/mo",
    "Metrics": "Close: 15%, Show: 60%"
  }
}
```

## 6. Outbox Result Location
`/campaigns/{brand}/revenue-optimization/funnel-leak-audit-report.md`

## 7. Google Drive Publishing Recommendation
Upload `funnel-leak-audit-report.md` to `Shared Drive/revenue-optimization/` folder.

## 8. Human-in-the-Loop Checkpoint
Verify the identified leaks list and ranking tasks with system engineer before changing workflow rules.

## 9. Safety / Claim Rules
Avoid introducing database schema refactoring or CRM field deletions during audit. Ensure active contacts pipeline logic is preserved.

## 10. Example Telegram Command
```text
/rev_opt audit
Brand Name: G&G Cleaning
Funnel Link: https://ggcleaningli.com/estimate
Traffic Volume: 1000 visitors/mo
Metrics: Close: 15%, Show: 60%
```
