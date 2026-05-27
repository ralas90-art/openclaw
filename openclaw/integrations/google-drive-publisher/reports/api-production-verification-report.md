# OpenClaw Google Drive Publisher — Production Verification Report (v2)

**Updated:** 2026-05-27  
**Previous version issues resolved:** Duplicate publishing, missing commands, stale handler logic.

---

## 1. Summary of Changes

This update resolves the duplicate publishing problem and adds two new Telegram commands:

| Issue | Resolution |
|:---|:---|
| `/drive_publish_latest` republished the same file on every invocation | `handleDrivePublishLatest()` now calls `drivePublisher.publishLatestToDrive()` which includes manifest-based duplicate detection |
| No way to publish only NEW (unpublished) files | `/drive_publish_pending` added — finds and publishes the latest file that has NOT yet been published |
| No way to force a re-upload intentionally | `/drive_republish_latest` added — bypasses duplicate detection and always uploads |
| `/drive_publish_pending` and `/drive_republish_latest` not wired to command router | Both commands added to `handleCommand()` dispatcher in `handlers.js` |
| `/help` text outdated | Updated to list all 5 Drive commands with the recommended workflow sequence |

---

## 2. Bug Fix & Root Cause Analysis

### Root Cause (Original — Fixed in Prior Version)
1. **Invalid Workspace Root Accepted**: `OPENCLAW_WORKSPACE_ROOT=/data/workspace` was accepted because the code only checked `fs.existsSync(envRoot)`. The directory existed on Railway as a persistent volume mount, but did **not** contain the actual OpenClaw repository files.
2. **Manifest File Selection**: The file crawler did not filter out `_manifest.json` or `publish_manifest` files, causing `/drive_publish_latest` to attempt uploading internal JSON logs.
3. **Path Case Mismatch**: On Windows, drive letter casing (e.g., `c:` vs `C:`) broke case-sensitive `.startsWith()` checks.

### Root Cause (Duplicate Publishing — Fixed This Version)
The `handleDrivePublishLatest()` handler in `handlers.js` called `drivePublisher.publishFileToDrive()` directly, bypassing the `publishLatestToDrive()` wrapper that contains `checkAlreadyPublished()` duplicate detection. Every call to `/drive_publish_latest` resulted in a new upload, creating multiple Drive copies of the same file.

### Resolution
- `handleDrivePublishLatest()` now delegates entirely to `drivePublisher.publishLatestToDrive()`.
- If the file was already published, the handler returns the existing Drive link with a clear "Already Published" message and instructions to use `/drive_republish_latest` or `/drive_publish_pending`.
- New `publishPendingToDrive()` scans all result files in priority order and skips any already recorded in the `google-drive-sync` manifest log.
- New `republishLatestToDrive()` bypasses the duplicate check entirely for intentional force re-uploads.

---

## 3. Workspace Root Resolution (Unchanged from v1)

1. `OPENCLAW_WORKSPACE_ROOT` — only if it contains valid repo markers
2. `__dirname`-derived app root — only if it contains valid repo markers
3. `/app` (Railway hardcoded fallback) — only if it contains valid repo markers
4. `process.cwd()` — only if it contains valid repo markers
5. If none found → error logged to console

**Repo marker check**: Validated by presence of `openclaw/bots/registry.md` OR both `server.js` + `package.json`.

---

## 4. File Priority Scoring (Unchanged from v1)

| Priority | Pattern | Description |
|:---:|:---|:---|
| 5 | `openclaw/outbox/telegram-responses/*_result.md` | Primary output: result files |
| 4 | `openclaw/outbox/telegram-responses/*.md` | Other response markdown |
| 3 | `openclaw/reports/*.md` | Internal reports |
| 2 | `campaigns/**/*.md` | Campaign markdown |
| 1 | `campaigns/**/*.{png,jpg,mp4,...}` | Campaign media |
| 0 | `*_manifest.json`, `publish_manifest_*`, `google-drive-sync/` | Always ignored |

---

## 5. Command Reference

| Command | Behavior |
|:---|:---|
| `/drive_publish_latest` | Publishes the highest-priority, most-recent file. Skips if already published — shows existing link instead |
| `/drive_publish_pending` | Finds the most-recent file that has NOT been published. Skips already-published files |
| `/drive_republish_latest` | Force re-uploads the latest file regardless of publish history. Creates a new Drive copy |
| `/drive_publish_file <filename>` | Publishes a specific named file from `telegram-responses/` |
| `/drive_publish_campaign <name>` | Publishes all files in a named campaign folder |
| `/drive_latest` | Shows info about the last published file (reads `google-drive-sync` manifest logs) |

### Recommended Workflow
```
1. /inbox_latest              ← see the latest queued request
2. Antigravity processes it   ← creates a new *_result.md in outbox
3. /drive_publish_latest       ← publishes it (or shows existing link if already done)
4. /drive_latest              ← verify the Drive link
```

---

## 6. Verification Details

| Step / Parameter | Status | Details |
|:---|:---:|:---|
| **`googleapis` dependency status** | ✅ **INSTALLED** | `googleapis: ^172.0.0` in `package.json` |
| **API env vars present** | ✅ **CONFIGURED** | Configured in Railway environment |
| **Service account parsed** | ✅ **VERIFIED** | Base64 decoding and JSON parsing validated |
| **Target Drive folder ID** | ✅ **VERIFIED** | `19kVuhi_J3ChOePzDdEyWR-Wrqv64QrN9` |
| **Result markdown prioritized** | ✅ **VERIFIED** | `_result.md` takes precedence over `_manifest.json` |
| **Google Drive sync logs ignored** | ✅ **VERIFIED** | `publish_manifest_*` files bypassed |
| **Railway path safety checks** | ✅ **VERIFIED** | Normalized prefix checks pass for Railway absolute paths |
| **Workspace root validation** | ✅ **VERIFIED** | `/data/workspace` rejected (no repo markers), `/app` accepted |
| **Path traversal blocked** | ✅ **VERIFIED** | Traversal tokens rejected |
| **`/drive_latest` reads history** | ✅ **VERIFIED** | Parses publish manifest logs from `google-drive-sync` |
| **Duplicate detection (`checkAlreadyPublished`)** | ✅ **VERIFIED** | Correctly identifies re-published files via manifest log scan |
| **`/drive_publish_latest` skips duplicates** | ✅ **VERIFIED** | Returns existing link with guidance message |
| **`/drive_publish_pending` skips published** | ✅ **VERIFIED** | Correctly targets only unpublished files |
| **`/drive_republish_latest` bypasses duplicate check** | ✅ **VERIFIED** | Always calls `publishFileToDrive()` |
| **`/drive_publish_pending` command wired** | ✅ **DONE** | Added to `handleCommand()` dispatcher |
| **`/drive_republish_latest` command wired** | ✅ **DONE** | Added to `handleCommand()` dispatcher |
| **`/help` updated** | ✅ **DONE** | Lists all 5 Drive commands + recommended workflow |

---

## 7. Automated Test Execution

All **12 test cases passed** (`scratch/test-drive-publisher.js`):

| # | Test | Status |
|:---:|:---|:---:|
| 1 | Result markdown prioritized over manifest JSON | ✅ |
| 2 | Google Drive sync manifests ignored | ✅ |
| 3 | No-file message returned when responses folder is empty | ✅ |
| 4 | Approved directory security check passes for responses folder | ✅ |
| 5 | Security check blocks files outside approved directories | ✅ |
| 6 | Railway-style absolute path `/app/.../file_result.md` passes | ✅ |
| 7 | Path traversal attempt is blocked | ✅ |
| 8 | `/drive_latest` reads publish history correctly | ✅ |
| 9 | `checkAlreadyPublished` detects a previously published file | ✅ |
| 10 | `/drive_publish_latest` blocks duplicate upload and returns existing link | ✅ |
| 11 | `/drive_publish_pending` skips published files and targets new unpublished file | ✅ |
| 12 | `/drive_republish_latest` force republishes regardless of prior history | ✅ |

---

## 8. GHL Setup Result File (Latest Outbox Entry)

The following file was generated to satisfy the previous Telegram inbox request for `revenue-master-orchestrator / ghl-setup`:

```
openclaw/outbox/telegram-responses/
  2026-05-27_05-28-06_revenue-master-orchestrator_ghl-setup_result.md
  2026-05-27_05-28-06_revenue-master-orchestrator_ghl-setup_manifest.json
```

This is the **current highest-priority file** for `/drive_publish_latest`.

---

## 9. Remaining Limitations

- The Railway env variable `OPENCLAW_WORKSPACE_ROOT=/data/workspace` is ignored (rejected by marker validation). Optionally update to `/app` for clarity.
- If the persistent volume `/data/workspace` is later populated with repo content, the resolver will automatically pick it up.
- `GOOGLE_DRIVE_PUBLISH_MODE=api` requires Railway env vars `GOOGLE_DRIVE_CREDENTIALS_BASE64` and `GOOGLE_DRIVE_OUTPUT_FOLDER_ID` to be set for live uploads.
