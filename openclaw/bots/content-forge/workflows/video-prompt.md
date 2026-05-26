# Workflow: /video-prompt

## Description
Generates Gemini/Veo animation prompts based on a user-selected base image.

## Inputs required from User
- Campaign
- Selected image (filename or reference)
- Desired duration
- Platform
- Motion style
- CTA

## Execution Steps

1. **Safety Gate**: Review the motion request. Ensure it relies on safe commercial wording.
2. **Invoke Skill**: `veo-image-to-video-director`
3. **Output Generation**:
   - Provide the Gemini/Veo image-to-video prompt.
   - Detail camera movement and subtle motion versions.
   - Provide first-frame / last-frame instructions.
   - Include a retry prompt if the generation fails.
4. **Manifest Update**: Invoke `campaign-asset-manifest-builder` to log the selected base image and the newly created video prompt into the `CAMPAIGN_ASSET_MANIFEST.md`.
5. **Human-in-the-Loop Pause**:
   - Output: *"Use these prompts in Gemini/Veo alongside your selected base image. Once generated, save the video files into `05-generated-videos/`. When you are ready to review them, run `/qa-video`."*
   - **WAIT** for the user.
