# Workflow: /rev_opt speed-lead

## 1. Purpose
Audits time-to-contact statistics and maps out instant automated follow-up sequences.

## 2. Inputs
- Brand Name
- Lead Response Time (average)
- Contact Channels
- CRM Software

## 3. Output Format
Automated SMS/Email notification alerts structure, speed-to-lead flow rules, and instant call-forwarding logic mapping.

## 4. Connected Skills
- `ghl-revenue-automation-builder`

## 5. Inbox JSON Structure
```json
{
  "source": "telegram",
  "status": "queued",
  "bot": "revenue-optimization-engine",
  "workflow": "speed-lead",
  "fields": {
    "Brand Name": "G&G Cleaning",
    "Response Time": "45 minutes",
    "Contact Channels": "SMS, Email",
    "CRM Software": "GoHighLevel"
  }
}
```

## 6. Outbox Result Location
`/campaigns/{brand}/revenue-optimization/speed-to-lead-blueprint.md`

## 7. Google Drive Publishing Recommendation
Upload `speed-to-lead-blueprint.md` to `Shared Drive/revenue-optimization/` folder.

## 8. Human-in-the-Loop Checkpoint
Verify contact time delays and notification SMS triggers match regulatory requirements before deploying sequences.

## 9. Safety / Claim Rules
Avoid automated calling dials without prior checkbox opt-in records confirmation. Follow local telecom guidelines.

## 10. Example Telegram Command
```text
/rev_opt speed_lead
Brand Name: G&G Cleaning
Response Time: 45 minutes
Contact Channels: SMS, Email
CRM Software: GoHighLevel
```
