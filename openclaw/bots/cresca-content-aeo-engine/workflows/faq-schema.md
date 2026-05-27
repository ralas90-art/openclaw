# Workflow: /aeo faq-schema

## Description
Generates semantic FAQ items and constructs valid JSON-LD schemas (FAQPage, LocalBusiness, Service) for search engines.

## Inputs required from User
- Brand Name
- Service Category
- Core FAQ Topics
- Business Location Details

## Execution Steps
1. **FAQ Copy Generation**: Write 5-10 high-intent questions and direct, concise answers.
2. **Schema Construction**: Code standard JSON-LD structures mapping the questions and business attributes.
3. **Invoke Skill**: `notebooklm-research-extractor` -> Pull key curriculum/service highlights to populate answers.
4. **Validation**: Verify JSON-LD syntactical correctness.
5. **Output**: Generate `aeo-faq-schema.json` under `/campaigns/{brand}/content-aeo/`.
6. **Checkpoint**: Pause for schema code validation.
