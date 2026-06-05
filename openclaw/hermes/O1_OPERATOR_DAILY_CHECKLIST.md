# Operator Daily Checklist — Phase O1 Dry-Run Monitoring

Operators should follow this structured checklist daily to verify the operational state, safety parameters, and security metrics of OpenClaw Hermes.

---

## 🌅 Morning Checks: Daily System Health

Verify the core API service, Telegram bot, and web portal are online and fully operational:

- [ ] **Telegram Status Queries**:
  - Run `/status` and `/run_status` to verify the Cresca OS runtime is responding.
  - Run `/hermes_health` and `/hermes_status` to check queue engine connectivity.
  - Run `/hermes_queue` and `/hermes_failures` to list active/stuck requests.
- [ ] **Web Portal Smoke Checks**:
  - Navigate to `/dashboard?token=<INTERNAL_ADMIN_TOKEN>` to verify the landing overview.
  - Navigate to `/dashboard/brief?token=<INTERNAL_ADMIN_TOKEN>` to inspect today's brief.
  - Navigate to `/dashboard/usage?token=<INTERNAL_ADMIN_TOKEN>` to verify analytics and model cost ledger.

---

## ⚙️ Operational Flow Checks

Review, triage, and execute incoming dry-run tasks during regular operation:

- [ ] **Triage & Review**:
  - Inspect `/dashboard/queue` to review newly ingested tasks in the queue registry.
- [ ] **Dry-Run Dispatch**:
  - Trigger `/hermes_dispatch <jobId>` on Telegram (or temporarily via Web confirmation if actions enabled) for verified safe dry-run tasks.
- [ ] **Approval Validation**:
  - View the approval queue (`/hermes_approval`). Ensure that approvals are only granted after inspecting dry-run outputs.
- [ ] **Trace Reviews**:
  - Review trace logs on the `/dashboard/trace?jobId=...` page to inspect lifecycle steps and confirm path/credential redaction.
- [ ] **Drive Publishing**:
  - Confirm file publishing is executed only via explicit manual request (`/drive_publish_pending`), and duplicate checking resolves to existing links.
- [ ] **Verify Strict Dry-Run Execution**:
  - Inspect execution outputs (local or in `responses/`) to guarantee that all integrations run inside the dry-run simulation wrappers.

---

## 🌌 Evening Checks: Closeout & Safety Audit

Verify logs, cost boundaries, and ensure the dashboard remains secured:

- [ ] **Generate Daily Brief**:
  - Load `/dashboard/brief` to verify it compiles and caches today's brief metrics on disk.
- [ ] **Triage Failures & Blocked Jobs**:
  - Review failed jobs on the Queue page. Log reasons and retry safe jobs as needed.
- [ ] **Inspect Action Audit Logs**:
  - Check `dashboard-action-audit.json` on the server to review all POST actions and verify that failed/denied requests do not leak raw credentials.
- [ ] **Verify Usage Ledger**:
  - Inspect `llm-usage-ledger.json` to verify total cost and token consumption are tracked precisely.
- [ ] **Double-Check Safety Parameters**:
  - Confirm `realExecutionEnabled = false` is active.
  - Confirm `Connector registry` mode remains in `dry_run_only`.
  - Confirm `DASHBOARD_ACTIONS_ENABLED = false` is restored on Railway (unless intentionally testing actions).
