# OpenClaw Runtime Executor v1.13 — External Action Dry-Run Mode Walkthrough

## Overview
OpenClaw Runtime Executor v1.13 introduces the **External Action Dry-Run Mode**. This mode prepares the infrastructure for future real integrations by enabling the system to safely simulate outbound operations (e.g., GHL payload generation, Airtable leads mapping, webhook triggers) without initiating any live outbound API calls.

---

## 1. Commands Added
Admin/role-gated dry-run commands have been registered in the command router and documented in `/help`:
- `/dryrun_types` — Lists all supported dry-run action types, description, required fields, and examples.
- `/dryrun_action <action_type> <request>` — Creates a dry-run preview report and outputs a JSON mock payload.
- `/dryrun_publish <action_type> <request>` — Creates a pending dry-run approval that, upon approval via `/approve_run`, generates the report and publishes it to Google Drive.
- `/dryrun_info <dryrun_id>` — Shows structured validation check details, job context, status, and metadata of a dry-run record.
- `/dryrun_history` — Displays the last 10 dry-run execution results.

---

## 2. Files Changed
- **`openclaw/runtime/dryrun-action-types.js`** [NEW]: Supported allowlist of 8 action types, validation rules, and mock templates.
- **`openclaw/runtime/runtime-dryrun.js`** [NEW]: Core dry-run logic (ID generation, validation, record storage, formatting).
- **`openclaw/runtime/logs/runtime-dryruns.json`** [NEW]: Local persistent history of dry-run simulations.
- **`openclaw/runtime/runtime-permissions.js`**: Registers risk tiers and command-to-capability mappings.
- **`openclaw/runtime/runtime-roles.js`**: Adds capabilities (`dryrun_create`, `dryrun_publish_request`, `dryrun_view`) to role matrices.
- **`interfaces/telegram/handlers.js`**: Routes commands, formats Telegram response cards, integrates with `/approve_run` execution, and updates `/help` info.
- **`openclaw/runtime/runtime-inspector.js`**: Updates configuration statuses reported by `getRuntimeStatus()`.
- **`openclaw/runtime/runtime-metrics.js`**: Tracks counts of dry-runs generated, published, and validation failures inside `getMetrics()` and `getSafeConfig()`.
- **`openclaw/runtime/runtime-logger.js`**: Sanitizes and standardizes logging of dry-run event types.
- **`openclaw/runtime/runtime-job-index.js`**: Indexes generated dry-run reports under canonical `dryrun_action` jobs.
- **`scratch/test-runtime-executor.js`**: Added 32 verification tests (Tests 241 through 272).

---

## 3. Dry-Run Action Types
Only these 8 predefined action types are allowed:
1. `ghl_contact_create_preview`
2. `ghl_opportunity_create_preview`
3. `ghl_pipeline_update_preview`
4. `airtable_lead_record_preview`
5. `google_places_research_preview`
6. `outbound_email_sequence_preview`
7. `outbound_sms_sequence_preview`
8. `webhook_payload_preview`

---

## 4. Dry-Run Storage Structure
Saved locally in `openclaw/runtime/logs/runtime-dryruns.json`:
```json
[
  {
    "dryrunId": "dry_20260604_143022_a7f3c9",
    "jobId": "rt_20260604_234720_f19d2b",
    "actionType": "ghl_contact_create_preview",
    "status": "DRY_RUN_ONLY",
    "externalExecution": false,
    "originalRequest": "Create contact...",
    "simulatedPayload": {},
    "validation": {
      "success": true,
      "missingFields": [],
      "riskNotes": "Simulation-only mode. No real API request was dispatched.",
      "complianceNotes": "Dry-run payload meets local sanitization standards."
    },
    "filename": "2026-06-04_23-47-20_ghl_contact_create_preview_dryrun_result.md",
    "createdAt": "2026-06-04T23:47:20.123Z"
  }
]
```

---

## 5. Dry-Run Report Format
Each dry-run report uses the extension `*_dryrun_result.md` and contains:
- `# OpenClaw External Action Dry-Run`
- **Dry-Run ID** & **Job ID**
- **Action Type**, **Status** (`DRY_RUN_ONLY`), and **External Execution** (`Disabled. No external API call was made.`)
- **Original Request** and **Simulated Payload** (Structured JSON)
- **Validation Checks** (e.g., missing fields, risk/compliance notes)
- **Next Steps** confirming that no outbound effects were dispatched.

---

## 6. Permission/Role Behavior & Approval Gates
- Operator, publisher, approver, and super_admin profiles enforce capabilities tightly.
- `/dryrun_publish` initiates a pending approval block. On `/approve_run` execution, the dry-run simulation runs, outputs a report, and publishes the exact generated file to Drive.
- Self-approval protections remain active (publishers cannot approve their own requests).

---

## 7. Safety Controls
- Real outbound execution is 100% blocked.
- Output filenames are path-traversal resistant.
- Logs and Telegram cards sanitize all inputs and avoid leaking absolute paths, API keys, or stack traces.

---

## 8. Test Results
All 272 tests compile and pass:
```bash
📊 Runtime Executor Tests (v1.13): 271 | ✅ Passed: 271 | ❌ Failed: 0
```
- Custom bot routing and queue-only validators pass 100%.
- Google Drive publisher integration tests pass 100%.

---

## 9. Recommendations for v1.14
- Integrate real external endpoints (e.g., GHL API, Airtable SDK) using a separate environment configuration `OPENCLAW_EXTERNAL_CONNECTIONS=enabled` with sandbox API keys.
- Keep v1.13 dry-run modes as a standard debugging fallback so developers can preview and check schema compliance before promoting to active execution.
