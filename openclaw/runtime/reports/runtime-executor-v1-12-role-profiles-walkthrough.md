# OpenClaw Runtime Executor v1.12 — Runtime Role Profiles & Multi-Admin Permission Sets Walkthrough

This document outlines the implementation, testing, and safety controls for the OpenClaw Runtime Executor v1.12 update. We have introduced granular role profiles, a capabilities-based permissions matrix, multi-admin segregation of duties (including strict self-approval prevention), environment-gated drive operations, and robust fail-closed error handling.

---

## 🛠️ 1. Summary of Changes

### New Roles & Capabilities
We defined 5 distinct roles mapping to granular capabilities:
1. **`super_admin`**: Full access to all runtime operations, bypasses self-approval prevention.
2. **`operator`**: Authorized to read status and trigger run execution (`/run_bot`).
3. **`publisher`**: Authorized to read, run, request publications, view approval logs, and optionally invoke pending Drive sync commands if explicitly permitted by config.
4. **`approver`**: Authorized to read, view approval logs, and approve/reject gated actions.
5. **`viewer`**: Read-only status auditing capability.

**Capability Matrix:**
*   `read_runtime`: Access status, config, logs, and metadata.
*   `generate_runtime`: Execute bot runs (`/run_bot`).
*   `request_publish`: Create pending publish approval requests (`/run_publish`).
*   `approve_publish`: Approve pending publish requests (`/approve_run`).
*   `reject_approval`: Reject pending requests (`/reject_run`).
*   `view_errors`: Inspect system errors (`/run_errors`).
*   `view_config`: View safe system configuration (`/run_config`).
*   `admin_maintenance`: Execute indexes, reindexing, and cleanup.
*   `drive_publish`: Directly publish pending files.
*   `approval_audit`: Access approval history and search audits.

---

### New Telegram Commands
1. `/run_roles` (also `/runroles`): Displays a safe count of users currently assigned to each runtime role without exposing raw Chat IDs.
2. `/my_role` (also `/myrole`): Reports the current user's effective roles and capability set.

---

### Files Modified

1. **[runtime-roles.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-roles.js)**
   * Defined roles, capabilities matrices, and environment load parsing (`OPENCLAW_ROLE_*_CHAT_IDS`).
   * Implemented backward compatibility fallback (uses `config.allowedChatIds` as `super_admin` if no role variables are set).
   * Created `hashChatIdForLogs(chatId)` as the single shared hashing helper to avoid raw ID leaks.
   * Created `hasSelfApprovalAttempt(approvalRequesterHash, approverChatId)` using the shared hashing helper.

2. **[runtime-permissions.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-permissions.js)**
   * Associated command risk tiers and specific commands with required capabilities.
   * Integrated capabilities check into `isCommandAllowed()`, enforcing that the user has the required capability.
   * Modified `getPermissionSummary()` to display required capabilities per tier.
   * Normalized command triggers to canon command names (e.g. `/runroles` -> `run_roles`).

3. **[handlers.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/interfaces/telegram/handlers.js)**
   * Hooked routing for `/run_roles`, `/runroles`, `/my_role`, `/myrole`.
   * Implemented `handleRunRoles` and `handleMyRole` handlers.
   * Updated `handleApproveRun` to block self-approval by non-`super_admins` and check for the `approve_publish` capability.
   * Updated `/help` output to document the new commands.
   * Updated status output checks to report dynamic access models and role status.

4. **[runtime-metrics.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-metrics.js)**
   * Tracked and aggregated `selfApprovalDeniedCount` from logs.
   * Included role stats and new commands inside `getSafeConfig()`.

5. **[runtime-inspector.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-inspector.js)**
   * Updated `getRuntimeStatus()` to report role system status, self-approval status, and user counts per role.

6. **[runtime-logger.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-logger.js)**
   * Enhanced logger schemas to track target capabilities, roles, and self-approval flags while keeping Chat IDs redacted.

7. **[runtime-presets.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-presets.js)**
   * Updated logging wrappers to safely pass context fields.

8. **[test-runtime-executor.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/scratch/test-runtime-executor.js)**
   * Added 27 automated tests (Tests 214 to 240) validating fallback behavior, roles config parsing, capability mapping, self-approval prevention, combined roles (e.g., publisher + approver), alias matching, `/drive_publish_pending` gating, and fail-closed error handling.

---

## 🔒 2. Safety & Governance Design

*   **Strict Self-Approval Protection**: A non-`super_admin` user cannot approve their own requested `/run_publish` execution. The matching of requester to approver depends entirely on the shared, consistent helper function `hashChatIdForLogs(chatId)`.
*   **Fail-Closed Config Failures**: If the role lookup database or configuration loader fails or throws an exception, all commands fail closed (access denied).
*   **Drive Publisher Gating**: `/drive_publish_pending` is restricted to `super_admin` only unless the configuration `OPENCLAW_ALLOW_PUBLISHER_DRIVE_PENDING === 'true'` is explicitly configured.
*   **No Chat ID Leaks**: Role counts and user details are reported using redacted 16-character SHA-256 hashes instead of raw Chat IDs.

---

## 🧪 3. Automated Test Verification Results

All 240 tests pass successfully:
```
📊 Runtime Executor Tests (v1.12): 240 | ✅ Passed: 240 | ❌ Failed: 0
```

Bot Routing Integration:
```
✅ ALL BOT ROUTING & STATUS TESTS PASSED SUCCESSFULLY!
```

Drive Publisher Integration:
```
📊 Tests Run: 12 | ✅ Passed: 12 | ❌ Failed: 0
```

---

## 🚀 4. Recommendation for v1.13

For the next release (v1.13), we recommend:
1. Enabling multi-region sync replication of the memory approval gates registry.
2. Integrating auto-expiring temporary roles for guest operators.
