# Supabase Integration Module

## Overview
Cresca OS uses the Supabase (Postgres) integration as the primary persistence layer for all operations. This module provides a clean, centralized interface for agents to read tenant configurations and write operational data (leads, events, workflows).

## Configuration
The following environment variables are required in `.env`:
- `SUPABASE_URL`: The project URL (from Supabase Dashboard).
- `SUPABASE_SERVICE_ROLE_KEY`: The **service_role** secret key.

### ⚠️ Security Warning
The `SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security (RLS). 
- **NEVER** expose this key to the client-side/frontend.
- **NEVER** commit the `.env` file to version control.
- Use this key only in secure backend environments (e.g., Railway, GitHub Actions).

## Core Architecture

### 1. Persistence Layer (`integrations/supabase`)
Initializes the `@supabase/supabase-js` client with the service role key to allow high-level system operations (like creating tenants or modifying event logs).

### 2. Memory Module (`core/memory`)
Provides structured functions for managing state:
- `createLead()`: Saves a new business lead to the source of truth.
- `createWorkflowRun()`: Tracks the start and end of automated processes.
- `getTenantById()`: Retrieves the specific configuration (API keys, niche, settings) for a client.

### 3. Event Module (`core/events`)
Handles the persistent logging of system actions into the `event_logs` table. This allows us to maintain a full history of agent decisions.

## How to Use
Agents should never call the Supabase client directly. Instead, they should use the helper functions:

```javascript
const { createLead } = require('./core/memory');
const { emitEvent } = require('./core/events');

// 1. Process data
const lead = await createLead(tenantId, { name: 'G&G Cleaning', phone: '...' });

// 2. Log the achievement
await emitEvent(tenantId, 'lead.found', 'lead', lead.id, { source: 'google_places' });
```

## Testing the Connection
Run the following script to verify your setup:
```bash
node scripts/test-supabase-connection.js
```
