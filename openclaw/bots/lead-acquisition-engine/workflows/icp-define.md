# Workflow: /leads icp-define

## 1. Purpose
Builds a detailed Ideal Customer Profile (ICP) defining target industries, sizes, marketing behaviors, and pain points.

## 2. Inputs
- Brand Name
- Target Industry
- Core Value Proposition
- Target Location

## 3. Output Format
Detailed ICP template specifying firmographic details, spend signs, online presence gaps, and pain point summaries.

## 4. Connected Skills
- `lead-acquisition-engine`

## 5. Inbox JSON Structure
```json
{
  "source": "telegram",
  "status": "queued",
  "bot": "lead-acquisition-engine",
  "workflow": "icp-define",
  "fields": {
    "Brand Name": "SeptiVolt",
    "Target Industry": "Solar EPC",
    "Value Prop": "reduce rep onboarding time",
    "Target Location": "California"
  }
}
```

## 6. Outbox Result Location
`/campaigns/{brand}/lead-acquisition/prospect-icp-profile.md`

## 7. Google Drive Publishing Recommendation
Upload `prospect-icp-profile.md` to `Shared Drive/lead-acquisition/` folder.

## 8. Human-in-the-Loop Checkpoint
Validate target indicators list with outreach director before harvesting prospects database.

## 9. Safety / Claim Rules
Target criteria must avoid profiles containing compliance risks or children-related industries.

## 10. Example Telegram Command
```text
/leads icp_define
Brand Name: SeptiVolt
Target Industry: Solar EPC
Value Prop: reduce rep onboarding time
Target Location: California
```
