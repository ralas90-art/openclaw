# Workflow: /revenue offer-design

## 1. Purpose
Develops high-converting pricing offers and value-stacked packaging templates (Hormozi-style).

## 2. Inputs
- Brand Name
- Core Product/Service
- Current Pricing Structure
- Primary Competitors
- Key Customer Objections

## 3. Output Format
Outcomes, value stack, bonuses, risk reversal, and pricing tier layout.

## 4. Connected Skills
- `offer-engine-builder`
- `sales-process-optimizer`

## 5. Inbox JSON Structure
```json
{
  "source": "telegram",
  "status": "queued",
  "bot": "revenue-master-orchestrator",
  "workflow": "offer-design",
  "fields": {
    "Brand Name": "SeptiVolt",
    "Core Product": "solar training",
    "Current Pricing": "$500/mo",
    "Primary Competitors": "traditional courses",
    "Key Customer Objections": "pricing"
  }
}
```

## 6. Outbox Result Location
`/campaigns/{brand}/revenue-strategy/offer-design.md`

## 7. Google Drive Publishing Recommendation
Upload `offer-design.md` to `Shared Drive/revenue-strategy/` folder.

## 8. Human-in-the-Loop Checkpoint
Pause for user pricing and package stack approval before scripting any outreach copy.

## 9. Safety / Claim Rules
Ensure no misleading comparisons or deceptive claims regarding competitor metrics. Offer structures must represent real, viable prices.

## 10. Example Telegram Command
```text
/revenue offer_design
Brand Name: SeptiVolt
Core Product: solar training
Current Pricing: $500/mo
Primary Competitors: traditional courses
Key Customer Objections: pricing
```
