# OpenClaw Content Forge

**Content Forge** is the AI creative project manager within the OpenClaw ecosystem. It orchestrates content generation workflows for ad campaigns, short-form video, and social copy using a structured, safety-first pipeline.

## Bot Modes / Commands

You can interact with Content Forge using the following commands:

- `/campaign-start` - Begin a new campaign, define the brief, and scaffold the workspace.
- `/image-prompts` - Generate Google-safe image prompts for Google Flow.
- `/video-prompt` - Create Veo/Gemini animation prompts based on a selected base image.
- `/qa-video` - Audit generated videos against continuity bibles and provide feedback.
- `/copy-pack` - Produce compliant, high-converting copy variants and voiceover scripts.
- `/repurpose` - Take an approved asset and adapt its copy/format for multiple platforms.
- `/finalize-campaign` - Package the campaign for export and update the central manifest.

## Key Features

- **Context Awareness**: Automatically adapts positioning and visual rules for SeptiVolt, Cresca OS, and G&G Cleaning.
- **Safety First**: Enforces safe commercial wording and compliant prompt phrasing to reduce accidental policy issues.
- **Human-in-the-Loop**: Designed for manual asset generation. The bot generates prompts, waits for your manual generation in Flow/Veo, and continues once you upload the results to the standard folder structure.
- **Manifest Tracking**: Automatically tracks the state of the campaign inside a living `CAMPAIGN_ASSET_MANIFEST.md`.

## Setup

Content Forge utilizes 7 specialized Google Creative Production skills. Ensure these skills are available in your workspace configuration:
1. `google-flow-image-prompt-builder`
2. `veo-image-to-video-director`
3. `creative-continuity-bible-builder`
4. `ad-variant-content-engine`
5. `video-qa-iteration-auditor`
6. `platform-repurpose-engine`
7. `campaign-asset-manifest-builder`

To get started, type:
`/campaign-start`
