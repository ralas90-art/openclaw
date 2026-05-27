# Workflow: /aeo faq-schema

## 1. Purpose
Generates semantic FAQ items and constructs valid JSON-LD schemas (FAQPage, LocalBusiness, Service) for search engines.

## 2. Inputs
- Brand Name
- Service Category
- Core FAQ Topics
- Business Location Details

## 3. Output Format
Valid JSON-LD schema config code block and the human-readable FAQ question-and-answer list.

## 4. Connected Skills
- `notebooklm-research-extractor`

## 5. Inbox JSON Structure
```json
{
  "source": "telegram",
  "status": "queued",
  "bot": "cresca-content-aeo-engine",
  "workflow": "faq-schema",
  "fields": {
    "Brand Name": "Cresca OS",
    "Service Category": "Business Growth Engine",
    "Core FAQ Topics": "pricing, implementation, support",
    "Location Details": "Miami, FL"
  }
}
```

## 6. Outbox Result Location
`/campaigns/{brand}/content-aeo/aeo-faq-schema.json`

## 7. Google Drive Publishing Recommendation
Upload `aeo-faq-schema.json` to `Shared Drive/content-aeo/` folder.

## 8. Human-in-the-Loop Checkpoint
Validate syntax of the JSON-LD code block using schema validator tools before sitemap deployment.

## 9. Safety / Claim Rules
FAQ answers must represent direct facts. Avoid fluff or subjective value statements.

## 10. Example Telegram Command
```text
/aeo faq_schema
Brand Name: Cresca OS
Service Category: Business Growth Engine
Core FAQ Topics: pricing, implementation, support
Location Details: Miami, FL
```
