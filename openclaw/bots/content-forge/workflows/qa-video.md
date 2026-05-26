# Workflow: /qa-video

## Description
Audits a generated video, provides a QA scorecard, and revises prompts if the generation failed.

## Inputs required from User
- Campaign
- Video filename
- Original prompt
- What worked
- What failed

## Execution Steps

1. **Invoke Skill**: `video-qa-iteration-auditor`
2. **Output Generation**:
   - QA Scorecard.
   - Analysis of what worked and what failed.
   - Revised video prompt (if needed).
   - Pass/Fail recommendation.
3. **Manifest Update**: Invoke `campaign-asset-manifest-builder` to update the `CAMPAIGN_ASSET_MANIFEST.md` with the QA status and whether the video passed/failed.
4. **Human-in-the-Loop Pause**:
   - Ask the user to confirm if the video is approved or if it needs to be regenerated.
   - Once approved, proceed to `/copy-pack`.
