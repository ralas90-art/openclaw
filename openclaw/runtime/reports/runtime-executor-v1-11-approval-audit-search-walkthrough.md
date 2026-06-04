# OpenClaw Runtime Executor v1.11 — Approval Audit Trail & Approval Search Walkthrough

This document outlines the implementation, testing, and safety checks for the OpenClaw Runtime Executor v1.11 update. We have introduced approval history logs, case-insensitive substring search, status filtering, and expired pending approval maintenance.

---

## 🛠️ 1. Summary of Changes

### New Telegram Commands
1. `/approval_history` (also `/approvalhistory`): Shows the last 10 approval records safely, including created timestamps, status, bot slug or preset ID, execution/rejection details, related Job IDs, and Drive link status.
2. `/approval_search <keyword>` (also `/approvalsearch`): Performs a case-insensitive substring search on key approval fields, capped at 5 results.
3. `/approval_by_status <status>` (also `/approvalbystatus`): Lists the last 10 approvals matching the specified status (`pending`, `approved`, `rejected`, `expired`, `executed`, `failed`). Unknown statuses are safely rejected.
4. `/approval_cleanup_expired` (also `/approvalcleanupexpired`): Maintenance command that transitions pending approvals past their expiration time to `expired` status and logs telemetry.

### Files Modified

1. **[runtime-approvals.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-approvals.js)**
   - Added `getApprovalHistory(limit)`
   - Added `searchApprovals(query, limit)`
   - Added `getApprovalsByStatus(status, limit)` (maps `failed` status to both `'failed'` and `'execution_failed'` for compatibility)
   - Added `cleanupExpiredApprovals()`
   - Added `sanitizeApprovalSearchQuery(query)`
   - Added `summarizeApprovalForTelegram(approval)` to format logs cleanly without absolute paths or internal fields.

2. **[handlers.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/interfaces/telegram/handlers.js)**
   - Added routing in `handleCommand(text, message)`
   - Added command handlers: `handleApprovalHistory`, `handleApprovalSearch`, `handleApprovalByStatus`, `handleApprovalCleanupExpired`
   - Added security/admin gates checks on all four commands.
   - Updated `/help` text documentation block.
   - Shortened recommended next commands in `/run_status` message to stay safely below the 1000 characters Telegram safe message size limit.

3. **[runtime-permissions.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-permissions.js)**
   - Registered `/approval_history`, `/approval_search`, and `/approval_by_status` as Tier 1 (Read Only).
   - Registered `/approval_cleanup_expired` as Tier 4 (Admin Maintenance).
   - Added trigger aliases mapping in `normalizeCommand`.
   - Automatically included commands in `/run_permissions` grouped tiers display.

4. **[runtime-metrics.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-metrics.js)**
   - Integrated status-by-status approval counting in `getMetrics()` (returning exact fields: `approvalHistoryCount`, `pendingApprovals`, `approvedApprovals`, `rejectedApprovals`, `expiredApprovals`, `executedApprovals`, `failedApprovals`).
   - Added the four new commands to `getSafeConfig().enabledCommands`.

5. **[runtime-inspector.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-inspector.js)**
   - Updated `getRuntimeStatus()` to report:
     - `approvalAudit: 'Enabled'`
     - `approvalSearch: 'Enabled'`
     - `expiredCleanup: 'Available'`

6. **[test-runtime-executor.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/scratch/test-runtime-executor.js)**
   - Added 31 automated tests (Tests 183 to 213) to verify permissions, queries sanitization, history filters, and expired transitions.

---

## 🔒 2. Safety & Governance Design

- **Admin-Only Gating**: All new approval audit and search commands verify admin permissions against the centralized registry. Unauthorized requests are blocked and return a standardized permission denied message.
- **Substring Match Selection**: Searches use direct substring comparisons (`String.prototype.includes()`) instead of raw regular expressions, eliminating the risk of ReDoS (Regular Expression Denial of Service) injection.
- **Query Capping**: Search queries are capped at 50 characters and stripped of any characters outside `a-zA-Z0-9`, spaces, hyphens, and underscores.
- **Secret Redaction**: Message outputs sanitization replaces any filesystem absolute paths with generic paths (e.g. `openclaw/outbox/`). User message payloads and raw stack traces are never exposed.
- **Non-destructive Maintenance**: The cleanup command only mutates status flags of expired items; it never deletes records or executes commands.

---

## 🧪 3. Automated Test Verification Results

All 212 tests pass successfully:
```
📊 Runtime Executor Tests (v1.11): 212 | ✅ Passed: 212 | ❌ Failed: 0
```

Bot Routing Integration:
```
✅ ALL BOT ROUTING & STATUS TESTS PASSED SUCCESSFULLY! (16/16 Passed)
```

Drive Publisher Integration:
```
📊 Tests Run: 12 | ✅ Passed: 12 | ❌ Failed: 0
```

---

## 🚀 4. Recommendation for v1.12

For the next release (v1.12), we recommend:
1. Connecting dry-run hooks for external API execution.
2. Integrating Hermes coordination templates under gated approval workflow patterns.
3. Enabling telemetry webhooks for status transitions.
