# Phase 5: Productization Layer V1

## Overview
Phase 5 shifts Cresca OS from invisible backend infrastructure to an operable internal product. This phase introduces an internal Administrative Console designed for operations engineers to manage tenant onboarding, monitor runtime health, and oversee system coordination events.

## Components

### 1. Admin UI (React/Vite)
Located in `admin-ui/`.
- **Dashboard**: Real-time runtime status, database health, and active incidents.
- **Tenants**: List of all active tenants.
- **Tenant Detail**: View tenant integration status and credential health. Includes a "Test Sync" button for safe dry runs.
- **Operations**: Interfaces to view failed sync idempotency records and dead-letter queues. Includes a "Replay" mechanism.
- **Onboarding**: Form to safely onboard new tenants and associate their GHL provider credentials.

### 2. Admin API
Located in `api/admin.js` and mounted by `server.js` at `/api/admin`.
- Secured by a static `INTERNAL_ADMIN_TOKEN`.
- Endpoints mask sensitive data (like API keys and access tokens) before returning to the UI.
- Write actions (Safe Mode, Replay, Test Sync) are routed through the core `runtimeGovernor` and `runtimePreflight` engines, preserving the strict governance introduced in Phase 4.

### 3. Audit Logging
Every mutable action taken through the Admin API is logged into the `admin_action_logs` table (Supabase) to maintain strict compliance and traceability.

### 4. Executive Weekly Report Engine
Located in `core/reports/executiveWeeklyReport.js`.
- Aggregates metrics from the last 7 days (tenants, event success/failure rates, dead letters).
- Available via `/api/admin/reports/executive-weekly` for quick status summaries.

## Deployment
The `server.js` file has been updated to serve both the `admin-ui/dist` React build and the `/api/admin` routes over a single Express instance. The `package.json` uses `node server.js` as the start script, making this compatible with Railway single-service deployments.
