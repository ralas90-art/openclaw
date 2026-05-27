# Workflow: /rev_opt audit

## Description
Performs a step-by-step conversion and leakage audit across landing pages, offers, sales pipelines, and CRM systems.

## Inputs required from User
- Brand Name
- Funnel Link (Landing page, booking page)
- Traffic Volume / Ad Spend
- Close Rate & Show Rate Metrics

## Execution Steps
1. **Transition Check**: Map the transition percentages (`Leads -> Booked -> Show -> Close`).
2. **Leak Inspection**: Detect missing follow-up messages or slow response triggers.
3. **Invoke Skill**: `revenue-optimization-engine` or `ghl-config-auditor` -> Conduct the systematic leakage audit.
4. **Output**: Generate `funnel-leak-audit-report.md` under `/campaigns/{brand}/revenue-optimization/`.
5. **Checkpoint**: Pause for audit results review.
