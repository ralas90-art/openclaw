# Workflow: /campaign-start

## Description
Initializes a new creative campaign, setting up the required folder structure, briefs, and continuity guidelines.

## Inputs required from User
- Brand Name
- Campaign Name
- Goal
- Target Audience
- Offer
- Platform
- Style

## Execution Steps

1. **Context Resolution Check**: If Brand is "SeptiVolt", "Cresca OS", or "G&G Cleaning", load the global Context Resolution Rule from `BOT.md` and apply brand identity constraints.
2. **Safety & Compliance Check**: Run the Campaign Idea against the Compliance Gate (see `BOT.md`). Enforce safe commercial wording.
3. **Invoke Skill**: `campaign-asset-manifest-builder` -> Generate the folder structure and `CAMPAIGN_ASSET_MANIFEST.md`.
4. **Invoke Skill**: `creative-continuity-bible-builder` -> Generate visual identity rules, color guidelines, and `brief.md`.
5. **Output**: 
   - Display the compliance status.
   - Output the folder structure.
   - Display the continuity rules.
6. **Human-in-the-Loop Pause**: Wait for user approval to proceed to `/image-prompts`.
