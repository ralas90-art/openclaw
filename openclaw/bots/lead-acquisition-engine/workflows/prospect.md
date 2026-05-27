# Workflow: /leads prospect

## 1. Purpose
Sources and qualifies potential client targets from ad platforms or local business directories.

## 2. Inputs
- Brand Name
- Target Location
- Platform Focus (e.g. Google Ads, Facebook Ads, maps)
- Minimum Qualification Criteria

## 3. Output Format
CSV structure holding columns: Name, URL, Contact, Ad Status, Website Defects, Opportunity.

## 4. Connected Skills
- `lead-acquisition-engine`

## 5. Inbox JSON Structure
```json
{
  "source": "telegram",
  "status": "queued",
  "bot": "lead-acquisition-engine",
  "workflow": "prospect",
  "fields": {
    "Brand Name": "SeptiVolt",
    "Target Location": "California",
    "Platform Focus": "Google Ads",
    "Qualification Criteria": "Slow loading site"
  }
}
```

## 6. Outbox Result Location
`/campaigns/{brand}/lead-acquisition/qualified-lead-list.csv`

## 7. Google Drive Publishing Recommendation
Upload `qualified-lead-list.csv` to `Shared Drive/lead-acquisition/` folder.

## 8. Human-in-the-Loop Checkpoint
Verify contact info validity before exporting database to emailing cadences.

## 9. Safety / Claim Rules
Expressed do-not-contact registers must be crossed-referenced. Sourced leads must show actual ad spend intent.

## 10. Example Telegram Command
```text
/leads prospect
Brand Name: SeptiVolt
Target Location: California
Platform Focus: Google Ads
Qualification Criteria: Slow loading site
```
