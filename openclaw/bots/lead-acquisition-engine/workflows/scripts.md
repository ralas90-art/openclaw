# Workflow: /leads scripts

## 1. Purpose
Generates personalized, problem-centric cold outreach scripts for cold calling, DMs, and emails.

## 2. Inputs
- Brand Name
- Target Segment
- Offer / Pitch
- Lead Deficit/Opportunity Angle

## 3. Output Format
Outreach templates grouped by channel (Email, DM, phone cold call script) with clear variables slots.

## 4. Connected Skills
- `lead-acquisition-engine`

## 5. Inbox JSON Structure
```json
{
  "source": "telegram",
  "status": "queued",
  "bot": "lead-acquisition-engine",
  "workflow": "scripts",
  "fields": {
    "Brand Name": "SeptiVolt",
    "Target Segment": "Solar EPC Manager",
    "Offer": "Founding pilot trial",
    "Lead Deficit": "missing FAQ schema on landing page"
  }
}
```

## 6. Outbox Result Location
`/campaigns/{brand}/lead-acquisition/outreach-script-pack.md`

## 7. Google Drive Publishing Recommendation
Upload `outreach-script-pack.md` to `Shared Drive/lead-acquisition/` folder.

## 8. Human-in-the-Loop Checkpoint
Outbox copy must be approved by compliance lead before uploading sequences to active CRM.

## 9. Safety / Claim Rules
Message copy must not make false or guaranteed performance metrics statements (e.g. "We promise 20 new reps next week").

## 10. Example Telegram Command
```text
/leads scripts
Brand Name: SeptiVolt
Target Segment: Solar EPC Manager
Offer: Founding pilot trial
Lead Deficit: missing FAQ schema on landing page
```
