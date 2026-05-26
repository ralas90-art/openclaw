# Telegram Command Map

## General Commands
- `/help` - Show available commands
- `/bots` - List Active and Documented OpenClaw bots
- `/registry` - View registry stats

## Content Forge Commands
Alias: `/content_forge` or `/cf`

| Command | Triggers Workflow | Next Step |
|---|---|---|
| `/cf campaign_start` | `campaign-start` | Saved to inbox |
| `/cf image_prompts` | `image-prompts` | Generates Flow prompts |
| `/cf video_prompt` | `video-prompt` | Generates Veo prompts |
| `/cf qa_video` | `qa-video` | Iterates QA |
| `/cf copy_pack` | `copy-pack` | Generates copy |
| `/cf repurpose` | `repurpose` | Adapts for platforms |
| `/cf finalize_campaign`| `finalize-campaign`| Final asset prep |

**Example Multiline Payload:**
```text
/cf image_prompts
Project: SeptiVolt
Campaign: Batch 001 Founder Demo Ad
Prompt Count: 5
Aspect Ratio: 9:16
```

## Future Bot Commands (Placeholders)
- `/revenue campaign_prioritizer` (Currently blocked by Documented Only status).

## Legacy Runtime Commands
- `/status`
- `/health`
- `/queues`
- `/pause-queue`
- `/resume-queue`
