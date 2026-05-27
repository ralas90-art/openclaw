# Workflow: /revenue system-design

## 1. Purpose
Initializes a strategic business model/acquisition pipeline blueprint. Evaluates target parameters to map out a structured growth stack.

## 2. Inputs
- Business Name
- Business Type (e.g. Agency, SaaS, Home Services)
- Active Channels (e.g. outbound, ads, organic)
- Monthly Revenue Goal

## 3. Output Format
Clean, structured markdown containing the growth stack stages (ICP, sourcing, CRM, and task sequencing).

## 4. Connected Skills
- `offer-engine-builder`
- `sales-process-optimizer`
- `ghl-revenue-automation-builder`

## 5. Inbox JSON Structure
```json
{
  "source": "telegram",
  "status": "queued",
  "bot": "revenue-master-orchestrator",
  "workflow": "system-design",
  "fields": {
    "Business Name": "SeptiVolt",
    "Business Type": "SaaS",
    "Active Channels": "outbound",
    "Monthly Revenue Goal": "$50k"
  }
}
```

## 6. Outbox Result Location
`/campaigns/{brand}/revenue-strategy/revenue-blueprint.md`

## 7. Google Drive Publishing Recommendation
Upload `revenue-blueprint.md` to `Shared Drive/revenue-strategy/` folder.

## 8. Human-in-the-Loop Checkpoint
Pause for user approval on the proposed system flow and growth priority stack before moving to offer design.

## 9. Safety / Claim Rules
Avoid promising specific revenue amounts or guaranteed timelines. Keep terms output-oriented rather than metric-guaranteed.

## 10. Example Telegram Command
```text
/revenue system_design
Business Name: SeptiVolt
Business Type: SaaS
Active Channels: outbound
Monthly Revenue Goal: $50k
```
