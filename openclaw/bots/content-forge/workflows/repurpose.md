# Workflow: /repurpose

## Description
Repurposes a single video or image asset across multiple ad platforms, adjusting copy and hooks.

## Inputs required from User
- Campaign
- Selected video/image
- Target platforms

## Execution Steps

1. **Invoke Skill**: `platform-repurpose-engine`
2. **Output Generation**:
   - TikTok version.
   - IG Reels version.
   - FB Reels version.
   - LinkedIn version.
   - YouTube Shorts version.
   - Landing page hero version.
3. **Action Item**: Add the new variant entries to the `CAMPAIGN_ASSET_MANIFEST.md`.
