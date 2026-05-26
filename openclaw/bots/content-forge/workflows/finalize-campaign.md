# Workflow: /finalize-campaign

## Description
Prepares the campaign for final export by organizing selected assets and updating the manifest.

## Inputs required from User
- Campaign
- Selected assets
- Platforms

## Execution Steps

1. **Invoke Skill**: `campaign-asset-manifest-builder`
2. **Output Generation**:
   - Updated `CAMPAIGN_ASSET_MANIFEST.md`.
   - Final export checklist.
   - Export naming convention map.
   - Platform usage plan.
   - Next batch recommendation.
3. **Completion**: Mark the campaign workflow as complete.
