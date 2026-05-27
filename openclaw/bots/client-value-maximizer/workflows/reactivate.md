# Workflow: /client_value reactivate

## 1. Purpose
Develops campaigns to re-engage past customers or cold, lost deals in the CRM.

## 2. Inputs
- Brand Name
- Target Audience (Past buyers, lost leads)
- Reactivation Offer / Incentive
- Communication Channels (SMS, Email)

## 3. Output Format
Reactivation campaign sequence roadmap, email sequence templates, and SMS alert strings.

## 4. Connected Skills
- `client-value-maximizer`
- `ghl-revenue-automation-builder`

## 5. Inbox JSON Structure
```json
{
  "source": "telegram",
  "status": "queued",
  "bot": "client-value-maximizer",
  "workflow": "reactivate",
  "fields": {
    "Brand Name": "G&G Cleaning",
    "Target Audience": "lost leads 6mo",
    "Reactivation Offer": "$30 off spring clean",
    "Channels": "SMS, Email"
  }
}
```

## 6. Outbox Result Location
`/campaigns/{brand}/client-value/reactivation-campaign-copy.md`

## 7. Google Drive Publishing Recommendation
Upload `reactivation-campaign-copy.md` to `Shared Drive/client-value/` folder.

## 8. Human-in-the-Loop Checkpoint
Copywriter and legal lead must approve target list filtering to prevent spamming active contacts.

## 9. Safety / Claim Rules
Ensure outreach scripts strictly comply with CAN-SPAM and local SMS opt-in laws. Must provide explicit opt-out info.

## 10. Example Telegram Command
```text
/client_value reactivate
Brand Name: G&G Cleaning
Target Audience: lost leads 6mo
Reactivation Offer: $30 off spring clean
Channels: SMS, Email
```
