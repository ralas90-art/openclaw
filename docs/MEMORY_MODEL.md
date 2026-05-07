# Operational Memory Model

## Goal
To provide agents with "shared consciousness" across sessions and integrations. Memory allows the system to remember that a lead was found on Monday, scored on Tuesday, and reached out to on Wednesday, regardless of which agent performed the action.

## Memory Layers
1. **Short-Term (Context):** Local execution state for a single event chain.
2. **Operational (Active):** Postgres tables tracking current "active" states (e.g., active lead searches, current audit status).
3. **Long-Term (History):** Full event logs and historical performance data in Postgres.

## Why Postgres as Source of Truth?
- **Relational Integrity:** Ensures that a lead is always tied to a tenant and an outreach attempt.
- **Auditability:** Every system decision can be traced back to a database record.
- **Cross-Platform Sync:** By writing to Postgres first, we can reliably sync data to "volatile" or "view-only" layers like Airtable or GHL without losing data.

## Memory Schema (Placeholder)
```sql
CREATE TABLE memory_blobs (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  key TEXT NOT NULL,
  value JSONB,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```
