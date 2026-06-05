# OpenClaw Runtime Final Baseline Audit

This audit documents the state of the OpenClaw Runtime Executor prior to implementing the final preparations for the Hermes queue engine.

---

## 1. Runtime Status & Version
- **Current Version:** v1.13 (with External Action Dry-Run Mode active).
- **Staging URL Health Check:** operational (`{"status":"ok"}`).

---

## 2. Approved Runtime Bots
Three bots are registered in the active runtime allowlist:
1. `revenue-master-orchestrator`
2. `content-forge`
3. `lead-acquisition-engine`

---

## 3. Existing Telegram Commands
The command router registers the following commands, validated against centralized permissions:
- **Registry & Info:** `/help`, `/bots`, `/registry`, `/chatid`, `/id`.
- **Inbox Operations:** `/inbox`, `/inbox_latest`, `/inbox_read`.
- **Execution & Output Checks:** `/run_bot`, `/run_publish`, `/run_status`, `/run_latest`, `/run_history`, `/run_metrics`, `/run_errors`, `/run_config`, `/run_job`, `/run_search`, `/run_by_bot`, `/run_reindex`.
- **Presets & Shortcuts:** `/preset_list`, `/preset_info`, `/run_preset`, `/run_preset_publish`.
- **Permissions & Roles:** `/run_permissions`, `/run_roles`, `/my_role`.
- **Google Drive Publisher:** `/drive_latest`, `/drive_publish_latest`, `/drive_publish_pending`, `/drive_republish_latest`, `/drive_publish_file`, `/drive_publish_campaign`.
- **Approval Gates:** `/approval_list`, `/approval_info`, `/approve_run`, `/reject_run`, `/approval_history`, `/approval_search`, `/approval_by_status`, `/approval_cleanup_expired`.
- **External Action Dry-Runs:** `/dryrun_action`, `/dryrun_publish`, `/dryrun_info`, `/dryrun_history`, `/dryrun_types`.

---

## 4. Permission Tiers & Command Risk Levels
Centralized commands map to risk tiers:
- **`read_only`:** Visibility check commands.
- **`generate_only`:** Write commands with local output files only.
- **`publish`:** Gated commands that upload exact files to Google Drive (require approval).
- **`admin_maintenance`:** Commands restricted to system maintenance tasks.
- **`external_action`** (Tier 5): Reserved for outbound integrations; strictly disabled in mock execution environment.

---

## 5. Verified Roles & Capabilities (Phase R1)
The role configuration loads from environment variables (`OPENCLAW_ROLE_..._CHAT_IDS`) with a safe fallback to `TELEGRAM_ALLOWED_RUNTIME_CHAT_IDS` as `super_admin`:
- **`super_admin`:** Unrestricted access to all capabilities, overrides self-approval checks.
- **`operator`:** Read and execution commands (`/run_bot`, `/run_preset`), no publishing.
- **`publisher`:** Read, execution, and publishing request commands (restricted from self-approval).
- **`approver`:** Approval gating auditing, execution, and rejection capability.
- **`viewer`:** Read-only command access only.

---

## 6. Security & Sandboxing Status
- **Approval Gates:** Enabled. `publish` tier triggers creation of pending approvals without immediate file output.
- **Dry-Run Mode:** Enabled. Generates simulation-only payload preview reports. Real external writes to GHL, Airtable, email/SMS, scrapers, and webhooks are 100% disabled.
- **Data Protection:** Outputs, logs, and stack traces sanitize paths, keys, and exclude raw chat IDs.

---

## 7. Baseline Test Counts
- **Unit & Security Tests:** 271 of 271 passed.
- **Bot Routing Suite:** 16 of 16 passed.
- **Drive Publisher Suite:** 12 of 12 passed.
- **Inconsistencies Identified:** None. All test numbering is aligned.

---

## 8. Missing Runtime Items Prior to Hermes
- **Connector Registry (Phase R2):** Requires schemas and registry indexing for `ghl`, `airtable`, `google_places`, `webhook`, `email`, and `sms` with validation commands.
- **Orchestration API (Phase R3):** Requires a unified internal API layer with a structured JSON response contract and source-awareness.
- **Readiness Tests:** Must include tests simulating Hermes orchestration calls.
