# Workflow: /aeo optimize-page

## 1. Purpose
Analyzes and rewrites landing page content for SEO rankings, Answer Engine Optimization (AEO), and Conversion Rate Optimization.

## 2. Inputs
- Page URL / Existing Copy
- Target Keywords
- Main Business Call to Action (CTA)
- Target Audience Persona

## 3. Output Format
Outcomes-focused landing page copy, primary headlines, CTA buttons text, and SEO meta tags.

## 4. Connected Skills
- `content-generation-engine`
- `brand-ux-consistency-auditor`

## 5. Inbox JSON Structure
```json
{
  "source": "telegram",
  "status": "queued",
  "bot": "cresca-content-aeo-engine",
  "workflow": "optimize-page",
  "fields": {
    "Page URL": "https://crescaos.com",
    "Target Keywords": "CRM automation",
    "Main CTA": "Book Demo",
    "Target Audience": "Small agency owners"
  }
}
```

## 6. Outbox Result Location
`/campaigns/{brand}/content-aeo/optimized-page-copy.md`

## 7. Google Drive Publishing Recommendation
Upload `optimized-page-copy.md` to `Shared Drive/content-aeo/` folder.

## 8. Human-in-the-Loop Checkpoint
Verify copywriting captures tone constraints and is reviewed by the editor before publishing to staging.

## 9. Safety / Claim Rules
**MANDATORY Copywriting Protocol:** Claude (Sonnet or Opus) MUST be used for all page copy. Do not make guaranteed revenue claims or misleading testimonials.

## 10. Example Telegram Command
```text
/aeo optimize_page
Page URL: https://crescaos.com
Target Keywords: CRM automation
Main CTA: Book Demo
Target Audience: Small agency owners
```
