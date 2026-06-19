# Jarvis Phase 7.1: Approval Audit Dashboard & Action History

This document outlines the design, commands, API endpoints, safety controls, and verification checklists for the Jarvis Approval Audit and Action History Layer.

---

## Overview
Phase 7.1 establishes a comprehensive audit and history layer for all Jarvis proposed, approved, rejected, cancelled, expired, executed, and failed actions. This ensures accountability, visibility, and safety for all decision-support actions.

---

## 1. Database Schema

### Telemetry Columns
We have updated the `jarvis_approval_requests` table to include the following telemetry columns:
*   `proposed_at` (`TIMESTAMPTZ` DEFAULT `now()`) - When the proposal was created.
*   `rejected_at` (`TIMESTAMPTZ`) - When the proposal was rejected.
*   `cancelled_at` (`TIMESTAMPTZ`) - When the proposal was cancelled by the requester or operator.
*   `expired_at` (`TIMESTAMPTZ`) - When the proposal expired.
*   `executed_by` (`TEXT`) - The actor who authorized the execution.
*   `source_priority_id` (`TEXT`) - The unique ID of the daily brief priority item.
*   `action_result_summary` (`TEXT`) - Safe summarized result of execution.
*   `execution_error_summary` (`TEXT`) - Safe sanitized error output on failure.

### Audit Events Table (`jarvis_approval_audit_events`)
Tracks granular transition states:
*   `id` (`UUID` PRIMARY KEY DEFAULT `gen_random_uuid()`)
*   `approval_id` (`UUID` REFERENCES `jarvis_approval_requests(id)`)
*   `event_type` (`TEXT`) - (e.g., `propose`, `approve`, `reject`, `cancel`, `expire`, `execute`, `execute_failed`)
*   `actor` (`TEXT`) - Chat ID or actor executing the transition.
*   `previous_status` (`TEXT`) - Previous state.
*   `new_status` (`TEXT`) - Transitioned state.
*   `safe_summary` (`TEXT`) - Sanitized summary description.
*   `created_at` (`TIMESTAMPTZ` DEFAULT `now()`)

---

## 2. Telegram Commands

### History Inspection

#### `/jarvis_approval_history`
List the 10 most recent approval requests.
*   **Example Output:**
    ```text
    📥 Jarvis Approval History (All Approvals)

    1. [HIGH] ⚡ Draft email response for message from john@client.com
       • ID: 35dfb032-4d1a-4d7a-b28f-763ad5ff6b7e
       • Status: executed | Project: septivolt
       • Proposed: 6/19/2026, 1:03:00 AM
    ```

#### `/jarvis_approval_history today`
List requests proposed or updated today.

#### `/jarvis_approval_history project <slug>`
Filter history by project slug (e.g. `septivolt`).

#### `/jarvis_approval_history status <status>`
Filter history by status (`pending`, `approved`, `rejected`, `cancelled`, `expired`, `executed`, `failed`).

### Summary Statistics

#### `/jarvis_approval_stats`
Aggregated counts by status and risk level.
*   **Example Output:**
    ```text
    📊 Jarvis Approval Statistics

    • Total Requests: 12

    Status Summary:
    • ⏳ Pending: 2
    • ✅ Approved: 1
    • ⚡ Executed: 6
    • 🛑 Rejected: 1
    • 🚫 Cancelled: 1
    • ⏰ Expired: 1
    • ❌ Failed: 0

    Risk Level Breakdown:
    • Low Risk: 4
    • Medium Risk: 5
    • High Risk: 3
    ```

---

## 3. Admin Dashboard APIs

All endpoints require admin token authentication via the HTTP header `Authorization: Bearer <INTERNAL_ADMIN_TOKEN>`.

### List Approvals
*   **Endpoint:** `GET /api/jarvis/approvals`
*   **Query Parameters:**
    *   `status` (optional): Filter by status.
    *   `project_slug` (optional): Filter by project.
*   **Response (JSON):**
    ```json
    [
      {
        "id": "35dfb032-4d1a-4d7a-b28f-763ad5ff6b7e",
        "approval_type": "proposal",
        "action_type": "draft_email_proposal",
        "project_slug": "septivolt",
        "status": "executed",
        "requested_action": "Draft email response for message from john@client.com",
        "risk_level": "high",
        "proposed_payload": {
          "_info": "[truncated for display]",
          "action": "draft_email_proposal",
          "project_slug": "septivolt",
          "truncated_payload_preview": "..."
        },
        "proposed_at": "2026-06-19T01:03:00.000Z",
        "executed_at": "2026-06-19T01:03:05.000Z",
        "executed_by": "12345",
        "action_result_summary": "Executed action successfully..."
      }
    ]
    ```

### Fetch Approval Details (with Audit Trail)
*   **Endpoint:** `GET /api/jarvis/approvals/:id`
*   **Response (JSON):**
    ```json
    {
      "id": "35dfb032-4d1a-4d7a-b28f-763ad5ff6b7e",
      "approval_type": "proposal",
      "action_type": "draft_email_proposal",
      "project_slug": "septivolt",
      "status": "executed",
      "requested_action": "Draft email response for message from john@client.com",
      "risk_level": "high",
      "proposed_payload": {
        "_info": "[truncated for display]",
        "action": "draft_email_proposal",
        "project_slug": "septivolt",
        "truncated_payload_preview": "..."
      },
      "audit_events": [
        {
          "id": "fa213bc5-cf22-49df-bbef-b31c26c7104b",
          "approval_id": "35dfb032-4d1a-4d7a-b28f-763ad5ff6b7e",
          "event_type": "propose",
          "actor": "jarvis",
          "previous_status": null,
          "new_status": "pending",
          "safe_summary": "Action proposal created for priority email:msg123",
          "created_at": "2026-06-19T01:03:00.000Z"
        },
        {
          "id": "c13898c8-f463-4ff0-b2b5-e6a2dc9efeb9",
          "approval_id": "35dfb032-4d1a-4d7a-b28f-763ad5ff6b7e",
          "event_type": "approve",
          "actor": "12345",
          "previous_status": "pending",
          "new_status": "approved",
          "safe_summary": "Request approved by 12345",
          "created_at": "2026-06-19T01:03:04.000Z"
        },
        {
          "id": "a90df2cd-ff8f-4fa1-9f20-9cbfe0bcbcbc",
          "approval_id": "35dfb032-4d1a-4d7a-b28f-763ad5ff6b7e",
          "event_type": "execute",
          "actor": "12345",
          "previous_status": "approved",
          "new_status": "executed",
          "safe_summary": "Executed action successfully...",
          "created_at": "2026-06-19T01:03:05.000Z"
        }
      ]
    }
    ```

### Aggregated Stats
*   **Endpoint:** `GET /api/jarvis/approval-stats`
*   **Response (JSON):**
    ```json
    {
      "status_counts": {
        "pending": 2,
        "approved": 1,
        "rejected": 1,
        "cancelled": 1,
        "expired": 1,
        "executed": 6,
        "failed": 0
      },
      "risk_breakdown": {
        "low": 4,
        "medium": 5,
        "high": 3
      }
    }
    ```

---

## 4. Safety Controls & Content Masking

1.  **Payload Truncation**: When payloads exceed 500 characters, dashboard detail API responses truncate them and replace them with a `_info` message (`"[truncated for display]"`) to prevent Telegram message limit overflow and credential leakages.
2.  **Secret Filtering**: Before saving or outputting any result, execution results (`action_result_summary`) and error logs (`execution_error_summary`) are passed through `sanitizeSecretKeywords()` to redact:
    *   PostgreSQL connections (`postgres://user:password@...`)
    *   Authorization Bearer Tokens (`Bearer ••••••••`)
    *   General API Keys (`api_key: "••••••••"`)
    *   Client Secrets (`client_secret: "••••••••"`)
3.  **Read-Only Operations**: Phase 7.1 is entirely read/audit focused. Jarvis does not execute external mutations such as sending emails, deleting files, or publishing live content.

---

## 5. Live Validation Checklist

*   [ ] Run `/jarvis_priorities` or `/jarvis_brief` to get a list of active priorities.
*   [ ] Copy a priority ID (e.g. `blocker:<id>`).
*   [ ] Run `/jarvis_action_preview <priority_id>`. Verify risk tier is printed.
*   [ ] Run `/jarvis_propose_action <priority_id>`. Verify it prints proposal ID.
*   [ ] Run `/jarvis_approval_stats`. Verify that "Pending" stats count increases.
*   [ ] Run `/jarvis_approval_history today`. Verify the new proposal appears in history with a ⏳ emoji.
*   [ ] Run `/jarvis_approve <approval_id>`. Verify output contains success response.
*   [ ] Run `/jarvis_approval_history status executed`. Verify the request is displayed with a ⚡ emoji.
*   [ ] Run `/jarvis_approval_stats`. Verify the "Executed" stats count increases.
*   [ ] Send an authorized HTTP request to `GET https://<staging_domain>/api/jarvis/approvals`. Verify status is 200 and details match.
*   [ ] Send an unauthorized HTTP request (missing Bearer token) to the same endpoint. Verify status is 401.
