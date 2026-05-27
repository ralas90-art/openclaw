# Workflow: /aeo optimize-page

## Description
Analyzes and rewrites landing page content for SEO rankings, Answer Engine Optimization (AEO), and Conversion Rate Optimization.

> [!IMPORTANT]
> **Claude Copywriting Protocol:** All page copywriting and headlines MUST be written by Claude.

## Inputs required from User
- Page URL / Existing Copy
- Target Keywords
- Main Business Call to Action (CTA)
- Target Audience Persona

## Execution Steps
1. **Keyword Mapping**: Map primary and secondary search phrases to page elements.
2. **Claude Copywriting**: Rewrite headlines and CTAs to emphasize outcomes and benefits over features.
3. **AEO Direct Answers**: Insert clear direct-answer text blocks for LLM extraction.
4. **Invoke Skill**: `content-generation-engine` -> Structure the rewritten elements.
5. **Output**: Generate `optimized-page-copy.md` under `/campaigns/{brand}/content-aeo/`.
6. **Checkpoint**: Pause for copy review.
