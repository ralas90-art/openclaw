# Workflow: /client_value referral

## Description
Establishes client referral incentive models and triggers them at key customer satisfaction points.

## Inputs required from User
- Brand Name
- Core Incentive (e.g. discount, cash reward)
- Trigger Event (e.g. project complete, 3rd cleanup)

## Execution Steps
1. **Trigger Definition**: Map the exact CRM webhook trigger indicating customer success.
2. **Incentive Packaging**: Structure double-sided referral rewards (referred buyer + referrer).
3. **Invoke Skill**: `client-value-maximizer` -> Plan the referral trigger sequence.
4. **Output**: Generate `client-onboarding-manifest.md` updates under `/campaigns/{brand}/client-value/`.
5. **Checkpoint**: Pause for referral flow confirmation.
