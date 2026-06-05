# Hermes Dashboard Railway Live Smoke Test Report (Phase D7)

This report documents the verification, authentication, routing, and security validation of the OpenClaw Hermes Dashboard on the live Railway deployment.

---

## 📋 General Details

*   **Verification Date:** June 5, 2026
*   **Git Commit Hash:** `eb5648e`
*   **Railway Service Name:** `openclaw-hermes`
*   **Staging Server URL:** `https://openclaw-hermes-staging.up.railway.app`

---

## 🛠️ 1. Environment Variable Checklist

| Env Variable Name | Required Value | Configured Status | Description |
| :--- | :--- | :--- | :--- |
| `DASHBOARD_ENABLED` | `true` | ✅ Configured | Enables the portal frontend. |
| `DASHBOARD_ACTIONS_ENABLED` | `false` / `true` | ✅ Configured | Defaults to `false` for read-only; toggled to `true` for action smoke tests. |
| `INTERNAL_ADMIN_TOKEN` | Cryptographic Secret | ✅ Configured | Gated portal access and POST validation. |
| `DASHBOARD_RATE_LIMIT_PER_MINUTE` | `20` | ✅ Configured | Restricts request frequencies. |
| `DASHBOARD_ACTION_NONCE_TTL_SECONDS` | `300` | ✅ Configured | CSRF confirmation nonce lifespan. |

---

## 🔒 2. Security & Authentication Checks

*   **Auth Gate Bypass Attempt:**
    *   *Method:* Request `/dashboard` and `/dashboard/queue` without `token` query parameters or headers.
    *   *Result:* Rejected with `401 Unauthorized`. Displayed Portal Login page.
    *   *Status:* ✅ PASSED
*   **Auth Gate Success Attempt:**
    *   *Method:* Request `/dashboard?token=<INTERNAL_ADMIN_TOKEN>`.
    *   *Result:* Accepted with `200 OK`. Renders the Overview diagnostic panel.
    *   *Status:* ✅ PASSED
*   **Missing Server Token Check:**
    *   *Method:* Request POST mutations with unconfigured/empty `INTERNAL_ADMIN_TOKEN`.
    *   *Result:* Rejected with `401 Unauthorized` and returned `Server admin token is not configured.`.
    *   *Status:* ✅ PASSED

---

## 🛰️ 3. Security Headers Validation

We validated headers returned by the server on staging:

- [x] **`X-Frame-Options`**: `DENY` (prevents clickjacking)
- [x] **`X-Content-Type-Options`**: `nosniff` (prevents MIME sniffing)
- [x] **`Referrer-Policy`**: `no-referrer` (stops token leak via referrers)
- [x] **`Content-Security-Policy`**: `default-src 'self' ...; style-src 'self' 'unsafe-inline' ...;` (restricts content delivery)

> [!NOTE]
> As noted in the CSP warning guidelines, `style-src` temporarily allows `'unsafe-inline'` to accommodate existing inline CSS styles. Tighter inline styles restrictions will be scheduled for a future design system sweep.

---

## 📋 4. Dashboard Route Smoke Tests

*   **Overview page (`/dashboard`):**
    *   Renders health statistics (Jobs created, completed, failed, active counts).
    *   Status: ✅ PASSED
*   **Queue page (`/dashboard/queue`):**
    *   Renders active and archived jobs correctly in the data table.
    *   Status: ✅ PASSED
*   **Trace page (`/dashboard/trace?jobId=...`):**
    *   Renders E2E trace visualization and sanitizes absolute paths and secrets.
    *   Status: ✅ PASSED
*   **Daily Brief page (`/dashboard/brief`):**
    *   Successfully loads today's daily brief snapshot and generates recommendation cards.
    *   Status: ✅ PASSED
*   **Usage page (`/dashboard/usage`):**
    *   Renders cost breakdown charts and model/provider token distribution logs.
    *   Status: ✅ PASSED

---

## ⚡ 5. Action Gating & Nonce Checks

### Read-Only Mode (`DASHBOARD_ACTIONS_ENABLED=false`)
*   **UI Controls Check:**
    *   Verify dispatch, cancel, retry, and approval buttons are hidden on the Queue, Trace, and Brief pages.
    *   *Status:* ✅ PASSED
*   **Mutation Endpoint Check:**
    *   POST `/dashboard/action/dispatch` yields `403 Forbidden`.
    *   *Status:* ✅ PASSED

### Operational Mutation Smoke Test (`DASHBOARD_ACTIONS_ENABLED=true`)
*   **Manual Dispatch / Cancel / Retry / Approve Flow:**
    *   *Confirm Nonce:* Requesting confirm GET routes successfully yields a one-time nonce.
    *   *Security Binding:* Nonce is verified to fail-closed if the action type (e.g. `cancel`) does not match the generated binding (e.g. `dispatch`).
    *   *Replay Prevention:* Nonces are consumed immediately upon POST submission. Resubmitting the same nonce returns `400 Bad Request`.
    *   *Dry-Run Execution:* Dispatched/approved actions route through the mock dispatcher wrapper. **No live connector writes were executed.**
    *   *Status:* ✅ PASSED

---

## 🛡️ 6. Stricter Audit Trails Validation

Audit logs saved on the server (`openclaw/dashboard/data/dashboard-action-audit.json`) were checked:

- [x] Denied attempts (invalid token, invalid nonce, rate limit hits) are captured.
- [x] Hashed IPs (`ip_hash_<sha256>`) are recorded for operator privacy.
- [x] Raw `INTERNAL_ADMIN_TOKEN` values are redacted.
- [x] Metadata fields do not store raw prompts or API credentials.

---

## 🔒 7. Connector Integrity Confirmation

*   **`realExecutionEnabled` check:** verified `false` across all integrations.
*   **`ConnectorMode` check:** verified `dry_run_only` mode in connector registry.
*   **Verdict:** Hermes remains strictly dry-run safe.

---

## 🏆 Final Verdict

**Hermes Dashboard is safe, hardened, and ready for operational live dry-run pilot deployment on Railway.**
