# Railway Deployment Checklist — Hermes Dashboard (Phase D6)

Use this checklist to verify, configure, and safely deploy the OpenClaw Hermes Dashboard on Railway.

---

## 🔑 1. Environment Variable Configuration

Ensure the following environment variables are configured in the Railway dashboard project settings:

- [ ] **`DASHBOARD_ENABLED`**: Enable or disable the entire web dashboard portal.
  - Value: `true` (default) or `false` (emergency disable).
- [ ] **`DASHBOARD_ACTIONS_ENABLED`**: Gate operational mutations (cancellation, retry, approval, dispatch).
  - Value: `true` (enables actions) or `false` (read-only mode; default and recommended for initial staging).
- [ ] **`INTERNAL_ADMIN_TOKEN`**: The master security token gating dashboard access.
  - Value: A cryptographically secure random string (minimum 32 characters). Do not reuse tokens across environments.
- [ ] **`DASHBOARD_RATE_LIMIT_PER_MINUTE`**: Limit API/confirm route requests from a single IP to prevent brute-forcing.
  - Value: `20` (default/recommended).
- [ ] **`DASHBOARD_ACTION_NONCE_TTL_SECONDS`**: CSRF one-time confirmation token lifespan.
  - Value: `300` (5 minutes, default/recommended).
- [ ] **`OPENCLAW_WORKSPACE_ROOT`**: Absolute path to workspace root.
  - Value: `/app` (or appropriate Railway directory).
- [ ] **`PORT`**: The server port exposed by Railway.
  - Value: Automatically provisioned by Railway (default `3000` fallback).

---

## 🔒 2. Security & Hardening Controls

Before promoting the deployment to production:

- [ ] **Zero Live Writes Confirmation**:
  - Verify `realExecutionEnabled` is set to `false` in all connector modules.
  - Verify `Connector Registry` reports only `dry_run_only` for all integrations.
- [ ] **Configured Token Requirement**:
  - Verify that `INTERNAL_ADMIN_TOKEN` is explicitly set. If it is missing or empty, all operational POST mutations will fail-closed and return `401 Unauthorized`.
- [ ] **CSP Headers & Style Warning**:
  - Verify `Content-Security-Policy` header contains standard rules.
  - > [!WARNING]
  - > The dashboard currently utilizes inline CSS styling. The CSP is configured to temporarily allow `style-src 'self' 'unsafe-inline'`. This is acceptable because the dashboard is a protected internal portal, but introducing style nonces/hashes remains a future hardening task.
- [ ] **Frame Options**:
  - Verify `X-Frame-Options` is set to `DENY` to prevent clickjacking/frame injection.
- [ ] **Content Sniffing**:
  - Verify `X-Content-Type-Options` is set to `nosniff`.
- [ ] **Referrer Policy**:
  - Verify `Referrer-Policy` is set to `no-referrer` to prevent leakage of admin tokens via referrer headers.

---

## 🛰️ 3. Operational Integrity & Verification

- [ ] **Status Smoke Test**:
  - GET `/dashboard?token=<INTERNAL_ADMIN_TOKEN>` returns `200 OK` and renders the Overview tab.
- [ ] **Invalid Token Rejection**:
  - GET `/dashboard?token=invalid_token` returns `401 Unauthorized` and displays the Portal Login page.
- [ ] **Disabled State Check**:
  - Set `DASHBOARD_ENABLED=false`. Verify GET `/dashboard` returns `403 Forbidden`.
- [ ] **Read-Only Action Verification**:
  - Set `DASHBOARD_ACTIONS_ENABLED=false`. Verify that no Action buttons are displayed on `/dashboard/queue` or `/dashboard/trace`, and POST requests to `/dashboard/action/*` return `403 Forbidden`.
- [ ] **Nonce Validation Check**:
  - Verify that manually submitting POST actions without a nonce, or with an invalid/expired nonce, returns `400 Bad Request`.
- [ ] **Audit Trail Generation**:
  - Inspect `/app/openclaw/dashboard/data/dashboard-action-audit.json` to verify that denied POST attempts and successful actions are strictly logged with redacted prompts, keys, and paths.

---

## 🚨 4. Emergency Action Plan

In the event of a security breach or unexpected behavior:

1. **Disable Mutations Immediately**: Set `DASHBOARD_ACTIONS_ENABLED=false` and redeploy. This instantly locks down all manual dispatch, cancel, retry, and approval endpoints (returning `403 Forbidden`).
2. **Disable Entire Portal**: Set `DASHBOARD_ENABLED=false` and redeploy. This blocks all GET/POST requests to `/dashboard/*` with `403 Forbidden`.
3. **Rotate Admin Token**: Generate a new value for `INTERNAL_ADMIN_TOKEN` and update the Railway environment variable.
