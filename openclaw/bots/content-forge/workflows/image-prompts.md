# Workflow: /image-prompts

## Description
Generates Google-safe image prompts using the `google-flow-image-prompt-builder` skill.

## Inputs required from User
- Campaign
- Number of prompts
- Aspect ratio
- Primary scene

## Execution Steps

1. **Context & Safety Gate**: Review the requested scene against the `Context Resolution Rule` for the active brand. Ensure safe commercial wording. Prevent fake claims, celebrity likenesses, and any policy-violating concepts.
2. **Invoke Skill**: `google-flow-image-prompt-builder`
3. **Output Generation**:
   - 5 to 10 image prompts tailored for Google Flow.
   - 9:16 vertical and 16:9 horizontal versions.
   - Negative prompts / avoid lists.
   - Recommendation for the first image to generate.
4. **Manifest Update**: Invoke `campaign-asset-manifest-builder` to update the `CAMPAIGN_ASSET_MANIFEST.md` with the newly created image prompts.
5. **Human-in-the-Loop Pause**: 
   - Display the compliance status.
   - Output: *"Generate these images in Google Flow. Once you select the best image, place it in the campaign folder under `03-generated-images/`. Then tell me which image you selected so I can create the matching Gemini/Veo animation prompt."*
   - **WAIT** for the user to select the image. Do not proceed to video prompts automatically.
