# OpenClaw Content Forge Installation Report

## Bot Details
**Bot Name:** Content Forge
**Bot Path:** `c:\Users\12132\.gemini\antigravity\playground\primal-astro\openclaw\bots\content-forge\`

## Implementation Summary

### Files Created
- `BOT.md` (Core instructions, context rules, safety gates)
- `README.md` (Documentation and quickstart)
- `/reports/septivolt-batch-001-validation.md` (Validation test)
- `/reports/installation-report.md` (This file)

### Workflows Created
- `/workflows/campaign-start.md`
- `/workflows/image-prompts.md`
- `/workflows/video-prompt.md`
- `/workflows/qa-video.md`
- `/workflows/copy-pack.md`
- `/workflows/repurpose.md`
- `/workflows/finalize-campaign.md`

### Skills Connected
Content Forge acts as an orchestrator for these 7 skills:
1. `google-flow-image-prompt-builder`
2. `veo-image-to-video-director`
3. `creative-continuity-bible-builder`
4. `ad-variant-content-engine`
5. `video-qa-iteration-auditor`
6. `platform-repurpose-engine`
7. `campaign-asset-manifest-builder`

### Rules Included
- **Context Resolution Rule:** Automatically applies constraints for SeptiVolt, Cresca OS, and G&G Cleaning based on the campaign name. Requires prompt for unknown brands.
- **Safety Rules:** Enforces safe commercial wording and compliant prompt phrasing to reduce accidental policy issues. Output follows a strict `Safe / Needs Revision / Do Not Generate` format.
- **Human-in-the-Loop Checkpoints:** Bot pauses at critical generation junctions (image generation, video generation, image selection) to allow human operators to interact with Flow/Veo directly before continuing.

## Validation Result
- **Test Campaign:** SeptiVolt Batch 001 Founder Demo Ad.
- **Outcome:** Passed. The bot correctly parsed the folder structure, identified that phase 1 workflows were complete, verified brand and safety alignment, and recommended the next human action. See `reports/septivolt-batch-001-validation.md` for full details.

## How to use the bot
To begin a new content production cycle or interact with Content Forge:
1. Initialize the bot by running: `/campaign-start`
2. Follow the prompt instructions provided by the bot.
3. Use `/image-prompts` and `/video-prompt` during the creative phases. 
4. Always pause and execute the required manual Flow/Veo generation tasks as indicated by the human-in-the-loop checkpoints.

## Recommended Next Campaign
Cresca OS Lead Capture Ad Batch or G&G Cleaning Instant Quote Flow Campaign.

## Remaining Risks or Limitations
- **Manual Generation:** Content Forge relies entirely on the operator to execute the generation tasks in Google Flow and Gemini/Veo. It cannot auto-execute or scrape results without dedicated API integrations or browser automation scripts. The workflow relies on strict adherence to the folder structure for placing output assets.
