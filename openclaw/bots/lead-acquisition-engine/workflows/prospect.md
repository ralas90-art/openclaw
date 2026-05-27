# Workflow: /leads prospect

## Description
Sources and qualifies potential client targets from ad platforms or local business directories.

## Inputs required from User
- Brand Name
- Target Location
- Platform Focus (e.g. Google Ads, Facebook Ads, maps)
- Minimum Qualification Criteria

## Execution Steps
1. **Source Search**: Scrape or compile businesses matching the ICP criteria.
2. **Qualify**: Check against deficits (e.g. running ads to a broken page, missing FAQ schema).
3. **Data Formatting**: Structure the output with business details, ad indicators, and specific opportunity angles.
4. **Invoke Skill**: `lead-acquisition-engine` -> Generate the qualified lead database.
5. **Output**: Generate `qualified-lead-list.csv` under `/campaigns/{brand}/lead-acquisition/`.
6. **Checkpoint**: Pause for lead list review.
