# Multi-Tenant Model

## Tenant Definition
A tenant represents a single business unit (e.g., "G&G Cleaning", "Solar Pro"). 

## Isolation Strategy
1. **Database Level:** Every table includes a `tenant_id`. Queries must always include a `WHERE tenant_id = ?` clause.
2. **API Level:** Integration keys (GHL API Key, Airtable Base ID) are stored per tenant in the `tenant_configs` table.
3. **Command Level:** Telegram users are mapped to a specific `tenant_id` to prevent cross-tenant command execution.

## Tenant Config Schema
```json
{
  "tenant_id": "uuid",
  "name": "Business Name",
  "integrations": {
    "ghl": { "api_key": "...", "location_id": "..." },
    "airtable": { "base_id": "...", "table_name": "..." },
    "telegram": { "authorized_users": ["chat_id_1"] }
  },
  "settings": {
    "niche": "roofing",
    "language": "es"
  }
}
```
