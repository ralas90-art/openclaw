# OpenClaw Runtime Executor Integration Contract

This contract defines the stable interface between the OpenClaw Runtime Executor foundation and external orchestrators (such as Hermes or Telegram handlers).

---

## 📥 1. Input Specifications & Source Awareness

All Orchestration API functions must accept a unified parameter object containing `source` and `metadata` to ensure job tracing and audit logs identify the caller.

### Source Types
Every call must specify a `source` parameter:
*   `telegram`: Calls originated from user interactions in the Telegram bot interface.
*   `hermes`: Calls originated from the automated Hermes job/workflow queue.
*   `test`: Calls originated from automated tests.
*   `system`: Calls originated from internal automated tasks or command line tools.

### Parameters
*   `botSlug` (string): The slug of the target approved runtime bot (e.g., `content-forge`).
*   `request` / `input` (string): The user request or input parameters, capped at configured boundaries.
*   `actor` (string|number): The chat ID or actor identifier requesting the run.
*   `source` (string): One of the approved source types.
*   `metadata` (object): Optional key-value pairs (e.g., `{ hermesJobId: "hm_123" }`) preserved and logged in the job telemetry.

---

## 📤 2. Output & Response Contract

Every Orchestration API call returns a structured response object. External orchestrators like Hermes rely on these fields for workflow routing and error handling.

### Success Response Contract
```json
{
  "ok": true,
  "status": "created",
  "jobId": "rt_20260604_200000_abcdef",
  "approvalId": null,
  "dryrunId": null,
  "filename": "2026-06-04_20-00-00_content-forge_runtime_result.md",
  "driveLink": null,
  "metadata": {
    "hermesJobId": "hm_test_123"
  }
}
```

### Error Response Contract
```json
{
  "ok": false,
  "status": "permission_denied",
  "errorCategory": "permission",
  "safeMessage": "Access Denied: You do not have permission to execute run_bot.",
  "jobId": null,
  "approvalId": null,
  "dryrunId": null
}
```

### Response Property Matrix

| Field | Type | Description |
| :--- | :--- | :--- |
| `ok` | Boolean | `true` if action succeeded/created. `false` if blocked, validation failed, or executed with error. |
| `status` | String | A granular state machine identifier: `'created'`, `'permission_denied'`, `'validation_failed'`, `'execution_failed'`, `'not_found'`, etc. |
| `errorCategory` | String \| null | Categorization for Hermes retry behavior: `'permission'`, `'validation'`, `'execution'`, `'internal_error'`, `'credentials_missing'`, `'network_timeout'`, etc. |
| `safeMessage` | String \| null | Safe error description suitable for external exposure without showing stack traces, credentials, or filesystem absolute paths. |
| `jobId` | String \| null | Unique tracking ID prefixed with `rt_` generated for executing runs. |
| `approvalId` | String \| null | Unique pending approval ID prefixed with `ap_` when gated commands (such as publishing) require review. |
| `dryrunId` | String \| null | Unique dry-run tracking ID prefixed with `dry_` when testing external action connectors. |
| `filename` | String \| null | Generated outbox markdown file basename inside `telegram-responses`. |
| `driveLink` | String \| null | Absolute Google Drive URL link if the job was published directly. |
| `metadata` | Object | Preserved caller-provided metadata dictionary. |

---

## 🔒 3. Capability & Role Mapping Matrix

Access is gated through a centralized permission tier system mapping actors to effective capabilities:

| Command | Capability Required | Default Tier | Allowed Roles | Action Gating |
| :--- | :--- | :--- | :--- | :--- |
| `/run_bot` | `run_bot` | Tier 3 | `super_admin`, `operator` | Execution Immediate |
| `/run_preset` | `run_preset` | Tier 3 | `super_admin`, `operator` | Execution Immediate |
| `/run_publish` | `run_publish` | Tier 4 | `super_admin`, `publisher` | Gated: Approval Required |
| `/run_preset_publish` | `run_preset_publish` | Tier 4 | `super_admin`, `publisher` | Gated: Approval Required |
| `/dryrun_action` | `dryrun_action` | Tier 3 | `super_admin`, `operator`, `publisher` | Execution Immediate |
| `/dryrun_publish` | `dryrun_publish` | Tier 4 | `super_admin`, `publisher` | Gated: Approval Required |

*Note: Viewers can execute read-only queries (`/run_status`, `/run_latest`, `/run_history`, `/approval_list`, `/my_role`) but are strictly blocked from requesting runs.*

---

## 🛠️ 4. Dry-Run Connector Registry Rules

All external integration writes (e.g., GoHighLevel, Airtable, Webhooks) must go through the connector registry.

1.  **Strict Sandbox Isolation**: Real network client queries or external execution is **permanently disabled** in the Runtime Executor layer.
2.  **Schema Enforcement**: Every action must map to a registered connector schema inside `connector-schemas.json`.
3.  **Simulated Outputs Only**: Registry operations generate dry-run markdown telemetry reports and JSON payloads saved in `telegram-responses/` to verify structural contract compliance without sending any network request.

---

## 📊 5. Telemetry & Audit Trails

1.  **Job Logs**: All execution logs are written to the unified event telemetry logs in `.jsonl` format.
2.  **Audit Integrity**: The caller's `source`, `actor`, and `metadata` must be written alongside job logs.
3.  **Self-Approval Gating**: Approval gates enforce self-approval prevention. A publisher requesting a publish job cannot approve their own pending approval unless they have effective `super_admin` permissions.
