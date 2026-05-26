# GHL Sync V1 - Multi-Tenant Infrastructure

Cresca OS GHL Sync V1 provides a robust, multi-tenant synchronization layer between Cresca OS (Supabase/Orchestration) and GoHighLevel (Execution).

## Core Architecture

- **Tenant-Aware Resolution**: Every sync request resolves credentials dynamically from the `integration_connections` table using the `tenant_id`.
- **Infrastructure First**: This layer handles data integrity and CRM state, not automated outreach messaging.
- **Config-Controlled Opportunities**: Opportunities are only created if the tenant's `settings.opportunity_sync_enabled` is explicitly set to `true`.

## Components

### 1. Integration Client (`integrations/ghl/client.js`)
A standardized Axios-based wrapper for the GoHighLevel API. Supports both API Key and OAuth (Access Token) authentication.

### 2. Connection Resolver (`integrations/ghl/connectionResolver.js`)
The primary source of truth for tenant credentials. It queries Supabase and maps database records to GHL connection parameters.

### 3. Sync Modules
- **Contacts**: Handles deduplication (Email/Phone) and upsert logic.
- **Notes**: Synchronizes lead scoring metadata (Score, Grade, Urgency). No AI-written copy is permitted in this version.
- **Tags**: Applies infrastructure tags (`cresca-synced`, `source-*`, `lifecycle-*`).
- **Opportunities**: Handles pipeline placement for high-intent leads (when enabled).

### 4. Event Handler (`core/events/handlers/ghlSyncRequested.js`)
Listens for the `ghl.sync.requested` event and orchestrates the sync flow across all modules.

## Operation & Logging

Every sync attempt is logged to:
- `event_logs`: Specific status events (skipped, started, completed, failed).
- `workflow_runs`: High-level execution traces with metadata and error tracking.

## Testing

Run the validation script with specific IDs:

```bash
node scripts/test-ghl-sync.js --tenant-id=YOUR_TENANT_ID --lead-id=YOUR_LEAD_ID
```

## Security & Fail-Safe

- **Graceful Failure**: If a tenant connection is missing or disabled, the system logs a `ghl.sync.skipped` event and continues without crashing.
- **Isolation**: Each tenant's data is synced using their specific `location_id` and credentials.
- **Read-Only Safety**: This version does not delete or aggressively overwrite existing GHL data.
