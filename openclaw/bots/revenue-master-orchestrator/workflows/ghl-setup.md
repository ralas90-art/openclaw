# Workflow: /revenue ghl-setup

## 1. Purpose
Maps CRM integrations, pipelines, stages, custom fields, and email/SMS trigger sequences.

## 2. Inputs
- Brand Name
- Lead Intake Sources (Forms, Facebook Ads, API)
- Desired Pipeline Stages
- Notification Recipients

## 3. Output Format
Detailed data schemas mapping custom contact fields, transition trigger states, and webhook timing rules.

## 4. Connected Skills
- `ghl-revenue-automation-builder`

## 5. Inbox JSON Structure
```json
{
  "source": "telegram",
  "status": "queued",
  "bot": "revenue-master-orchestrator",
  "workflow": "ghl-setup",
  "fields": {
    "Brand Name": "SeptiVolt",
    "Lead Intake Sources": "Web Form",
    "Desired Pipeline Stages": "Lead, Booked, Completed",
    "Notification Recipients": "sales@septivolt.com"
  }
}
```

## 6. Outbox Result Location
`/campaigns/{brand}/revenue-strategy/crm-mapping-manifest.md`

## 7. Google Drive Publishing Recommendation
Upload `crm-mapping-manifest.md` to `Shared Drive/revenue-strategy/` folder.

## 8. Human-in-the-Loop Checkpoint
Validate deduplication rules and stage criteria with the CRM owner before applying configuration changes.

## 9. Safety / Claim Rules
Confirm GDPR and CAN-SPAM opt-in checkboxes are properly logged and mapped on all custom intake forms.

## 10. Example Telegram Command
```text
/revenue ghl_setup
Brand Name: SeptiVolt
Lead Intake Sources: Web Form
Desired Pipeline Stages: Lead, Booked, Completed
Notification Recipients: sales@septivolt.com
```
