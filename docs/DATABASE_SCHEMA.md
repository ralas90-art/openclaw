# Database Schema: Phase 1 Foundation

## Postgres as the Source of Truth (SoT)
In Cresca OS, Postgres is the single version of the truth. While Airtable is used for visual review and GoHighLevel for outreach execution, the **state of any lead or workflow** is determined by the Postgres database. This ensures:
- **Consistency:** Multiple agents can work on the same lead without creating conflicting state in external tools.
- **Auditability:** We have a permanent record of why an AI scored a lead a certain way.
- **Portability:** If we switch from GHL to another CRM, our core data remains untouched.

## Core Tables

### 🏢 Tenants (`tenants`)
The root of the multi-tenant architecture. Every record in the system (except system-wide metadata) must belong to a tenant. This ensures that "Solar Pro" never sees data from "G&G Cleaning".

### 🔗 Integration Connections (`integration_connections`)
Stores the mapping between a tenant and their external tools. 
- **GHL:** Location IDs and API Keys.
- **Airtable:** Base IDs and Table Names.
- **Telegram:** Authorized chat IDs for that business.

### 👤 Leads (`leads`)
The primary repository for prospect data. This table stores stable information (Name, Phone, Website). 

### 🧠 Lead Intelligence (`lead_intelligence`)
A specialized table for "volatile" or agent-generated data. By separating intelligence from the core lead table, we can track multiple rounds of AI scoring or different outreach strategies without cluttering the primary lead record.

### 🔄 Workflow Runs (`workflow_runs`)
Tracks the lifecycle of automation. If a user triggers a "Find Leads" command, a record is created here to track the progress from `pending` to `completed`. This allows us to handle timeouts and retries gracefully.

### 📜 Event Logs (`event_logs`)
The "Event Store". Every significant action in the system emits an event which is logged here. 
- **Connects everything:** An event log entry can link to a `lead_id` and a `workflow_run_id`, allowing us to reconstruct exactly what happened during a specific run.

## Support for Multi-Tenancy
Multi-tenancy is enforced at the database level using:
1. **The `tenant_id` column:** Required on all operational tables.
2. **Foreign Key Constraints:** Ensures that data cannot exist without a valid parent tenant.
3. **Row Level Security (RLS):** Placeholders are in place to ensure that even a buggy agent cannot accidentally read data from another tenant at the query level.

## Intentionally Excluded from Phase 1
- **Vector Tables:** Vector search (pgvector) for "knowledge bases" will be added in Phase 2.
- **Auth/Users:** We are using System-level access for Phase 1. Granular dashboard users will be added later.
- **Complex RLS Policies:** Policies using `auth.uid()` are excluded until the Supabase Auth layer is integrated.
- **Materialized Views:** Analytics and reporting views will be added once we have sufficient data volume.
