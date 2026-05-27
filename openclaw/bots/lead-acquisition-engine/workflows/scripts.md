# Workflow: /leads scripts

## Description
Generates personalized, problem-centric cold outreach scripts for cold calling, DMs, and emails.

## Inputs required from User
- Brand Name
- Target Segment
- Offer / Pitch
- Lead Deficit/Opportunity Angle

## Execution Steps
1. **Hook Drafting**: Design hooks based on identified lead deficits (e.g. "Notice your landing page has no FAQ schema").
2. **Value Presentation**: State how your offer fixes their specific leak.
3. **Outreach Sequencing**: Map daily follow-ups across email, SMS, or LinkedIn.
4. **Invoke Skill**: `lead-acquisition-engine` -> Generate outreach script pack.
5. **Output**: Generate `outreach-script-pack.md` under `/campaigns/{brand}/lead-acquisition/`.
6. **Checkpoint**: Pause for scripting approval.
