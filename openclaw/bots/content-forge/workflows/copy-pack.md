# Workflow: /copy-pack

## Description
Generates social captions, ad copy, hooks, and voiceover scripts for the campaign.

## Inputs required from User
- Campaign
- Platform
- Tone
- Duration
- CTA

## Execution Steps

1. **Safety & Compliance Gate**: Ensure the copy uses safe commercial wording. Prevent fake testimonials, guaranteed claims, or deceptive before/afters.
2. **Invoke Skill**: `ad-variant-content-engine`
3. **Output Generation**:
   - Hooks.
   - Captions.
   - Ad copy.
   - On-screen text.
   - Voiceover scripts.
   - CTA variants.
4. **Manifest Update**: Invoke `campaign-asset-manifest-builder` to log the approved copy assets into the `CAMPAIGN_ASSET_MANIFEST.md`.
5. **Human-in-the-Loop Pause**: Wait for user to approve the copy before proceeding to `/finalize-campaign` or `/repurpose`.
