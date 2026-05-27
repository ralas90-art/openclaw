# Workflow: /rev_opt speed-lead

## Description
Audits time-to-contact statistics and maps out instant automated follow-up sequences.

## Inputs required from User
- Brand Name
- Lead Response Time (average)
- Contact Channels
- CRM Software

## Execution Steps
1. **Response Audit**: Evaluate the current response duration and detect drop-off risks.
2. **Workflow Mapping**: Blueprint immediate SMS/Email notification alerts and automated welcome templates.
3. **Invoke Skill**: `ghl-revenue-automation-builder` -> Design the speed-to-lead workflow specifications.
4. **Output**: Generate `speed-to-lead-blueprint.md` under `/campaigns/{brand}/revenue-optimization/`.
5. **Checkpoint**: Pause for automation workflow triggers verification.
