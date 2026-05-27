# Workflow: /revenue ghl-setup

## Description
Maps CRM integrations, pipelines, stages, custom fields, and email/SMS trigger sequences.

## Inputs required from User
- Brand Name
- Lead Intake Sources (Forms, Facebook Ads, API)
- Desired Pipeline Stages
- Notification Recipients

## Execution Steps
1. **Deduplication Check**: Blueprint contact deduplication rules and ID verification triggers.
2. **Workflow Mapping**: Structure stage transition states and time delays for follow-up triggers.
3. **Invoke Skill**: `ghl-revenue-automation-builder` -> Construct the CRM pipeline mapping manifest.
4. **Output**: Generate `crm-mapping-manifest.md` under `/campaigns/{brand}/revenue-strategy/`.
5. **Checkpoint**: Pause for user webhook configuration verification.
