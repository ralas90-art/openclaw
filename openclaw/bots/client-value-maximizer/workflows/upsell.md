# Workflow: /client_value upsell

## Description
Designs backend monetization options, premium upgrades, recurring subscriptions, or cross-sell packages.

## Inputs required from User
- Brand Name
- Core Service Purchased
- Core Pricing
- Customer Feedback / Pain Points after Purchase

## Execution Steps
1. **Lifecycle Mapping**: Identify purchase milestones to locate backend sales opportunities.
2. **Offer Restructuring**: Formulate complementary packages or scheduled maintenance subscriptions.
3. **Invoke Skill**: `client-value-maximizer` -> Formulate upsell tier recommendations.
4. **Output**: Generate `customer-lifecycle-monetization-map.md` under `/campaigns/{brand}/client-value/`.
5. **Checkpoint**: Pause for tier structuring approval.
