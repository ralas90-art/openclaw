# Workflow: /client_value upsell

## 1. Purpose
Designs backend monetization options, premium upgrades, recurring subscriptions, or cross-sell packages.

## 2. Inputs
- Brand Name
- Core Service Purchased
- Core Pricing
- Customer Feedback / Pain Points after Purchase

## 3. Output Format
Customer lifecycle map visual representation, monetization gaps list, and premium upgrade pricing sheet.

## 4. Connected Skills
- `client-value-maximizer`

## 5. Inbox JSON Structure
```json
{
  "source": "telegram",
  "status": "queued",
  "bot": "client-value-maximizer",
  "workflow": "upsell",
  "fields": {
    "Brand Name": "G&G Cleaning",
    "Core Service": "standard cleanup",
    "Core Pricing": "$150",
    "Customer Feedback": "loves the organic clean option"
  }
}
```

## 6. Outbox Result Location
`/campaigns/{brand}/client-value/customer-lifecycle-monetization-map.md`

## 7. Google Drive Publishing Recommendation
Upload `customer-lifecycle-monetization-map.md` to `Shared Drive/client-value/` folder.

## 8. Human-in-the-Loop Checkpoint
Ensure the proposed upsell tiers align with product fulfillment capacity before launching.

## 9. Safety / Claim Rules
Tiers pricing must be transparent. Do not map hidden automatic billing models without customer consent.

## 10. Example Telegram Command
```text
/client_value upsell
Brand Name: G&G Cleaning
Core Service: standard cleanup
Core Pricing: $150
Customer Feedback: loves the organic clean option
```
