# Workflow: /client_value reactivate

## Description
Develops campaigns to re-engage past customers or cold, lost deals in the CRM.

## Inputs required from User
- Brand Name
- Target Audience (Past buyers, lost leads)
- Reactivation Offer / Incentive
- Communication Channels (SMS, Email)

## Execution Steps
1. **List Filtering**: Define segment criteria to avoid spamming active deals.
2. **Copywriting**: Write multi-touch re-engagement message sequences (SMS + Email).
3. **Invoke Skill**: `client-value-maximizer` or `ghl-revenue-automation-builder` -> Design the campaign sequence.
4. **Output**: Generate `reactivation-campaign-copy.md` under `/campaigns/{brand}/client-value/`.
5. **Checkpoint**: Pause for messaging compliance validation.
