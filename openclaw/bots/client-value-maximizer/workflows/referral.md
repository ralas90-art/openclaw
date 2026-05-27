# Workflow: /client_value referral

## 1. Purpose
Establishes client referral incentive models and triggers them at key customer satisfaction points.

## 2. Inputs
- Brand Name
- Core Incentive (e.g. discount, cash reward)
- Trigger Event (e.g. project complete, 3rd cleanup)

## 3. Output Format
Trigger events sequence layout, double-sided reward pricing details, and email template scripts.

## 4. Connected Skills
- `client-value-maximizer`

## 5. Inbox JSON Structure
```json
{
  "source": "telegram",
  "status": "queued",
  "bot": "client-value-maximizer",
  "workflow": "referral",
  "fields": {
    "Brand Name": "G&G Cleaning",
    "Incentive": "$20 credit each",
    "Trigger Event": "Completion of 3rd clean"
  }
}
```

## 6. Outbox Result Location
`/campaigns/{brand}/client-value/client-onboarding-manifest.md` (updates)

## 7. Google Drive Publishing Recommendation
Upload `client-onboarding-manifest.md` to `Shared Drive/client-value/` folder.

## 8. Human-in-the-Loop Checkpoint
Verify the trigger event matches correct client-reported delivery milestones before dispatching loops.

## 9. Safety / Claim Rules
Avoid promising cash payouts unless payout terms are explicitly documented and approved by finance.

## 10. Example Telegram Command
```text
/client_value referral
Brand Name: G&G Cleaning
Incentive: $20 credit each
Trigger Event: Completion of 3rd clean
```
