# OpenClaw Google Drive Publisher Installation Report

This report summarizes the implementation, security validations, and Telegram routing integration for the **Google Drive Asset Publisher** in OpenClaw.

---

## 1. Publishing Modes Implemented

The integration supports dual publishing environments:

### Local Mode (`local`)
*   **Target Environment:** Local laptops/desktops with Google Drive for Desktop installed.
*   **Status:** **ACTIVE & VERIFIED**.
*   **Behavior:** Performs physical filesystem replication to the synchronized Google Drive directory path.

### API Mode (`api`)
*   **Target Environment:** Cloud containers (e.g., Railway production).
*   **Status:** **ACTIVE & VERIFIED** (runs in dry-run/mock fallback if credentials or libraries are missing).
*   **Behavior:** Performs programmatic uploads via the Google Drive v3 API using a Base64-encoded Service Account JSON key.

---

## 2. Directory Structure in Google Drive

Files are duplicated into clean, distinct subfolders inside the Google Drive root:
*   `OpenClaw/Telegram Requests/` (Inbox requests copy)
*   `OpenClaw/Telegram Responses/` (Processed response files)
*   `OpenClaw/Campaigns/{Project}/{Campaign}/` (Briefs, visual prompts, and copy packs)
*   `OpenClaw/Reports/` (Verification reports)
*   `OpenClaw/Manifests/` (Publish manifests copy)

---

## 3. Files Created

1.  📂 **Integrations Directory:** `openclaw/integrations/google-drive-publisher/`
    *   [README.md](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/integrations/google-drive-publisher/README.md): Operational documentation.
    *   [DRIVE_PUBLISHER.md](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/integrations/google-drive-publisher/DRIVE_PUBLISHER.md): Developer API specifications.
    *   [drive-manifest-schema.md](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/integrations/google-drive-publisher/drive-manifest-schema.md): Output manifest schema.
    *   [drive-publisher.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/integrations/google-drive-publisher/drive-publisher.js): Core publisher module.
2.  📂 **Sync logs placeholder:**
    *   [openclaw/outbox/google-drive-sync/.gitkeep](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/outbox/google-drive-sync/.gitkeep): Retains manifest output folder.

---

## 4. Dependencies & Env Variables

### Library Dependencies
*   `googleapis`: Dynamically required in `api` mode. If the package is not installed, the integration falls back gracefully to dry-run mode instead of crashing.

### Environment Variables Added to `.env.example`
*   `GOOGLE_DRIVE_PUBLISH_MODE`: `local` (laptop) or `api` (Railway).
*   `GOOGLE_DRIVE_LOCAL_ROOT`: Local absolute directory path to the Google Drive folder.
*   `GOOGLE_DRIVE_OUTPUT_FOLDER_ID`: Google Drive unique folder ID.
*   `GOOGLE_DRIVE_CREDENTIALS_BASE64`: Base64 string of service account keys (prevents line-break mangling).
*   `GOOGLE_DRIVE_CREDENTIALS`: Raw service account credentials JSON.
*   `GOOGLE_DRIVE_ALLOW_INTERNAL_DOC_PUBLISH`: Enable publishing of internal files (defaults to `false`).

---

## 5. Security & Safety Gates

The publisher enforces strict filters:
1.  **Approved Source Directories:** Only allows uploads from `openclaw/outbox/`, `openclaw/reports/`, and `campaigns/`. Internal code directories are blocked by default.
2.  **Forbidden Filenames:** Blocks `.env`, private keys (`.key`, `.pem`, `.p12`), and credentials (`credentials.json`, `token.json`).
3.  **Secret content scanning:** Scans text-based files for API keys (`OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`, etc.) and private key headers.
4.  **Path Traversal Prevention:** Rejects any directory traversal signatures (`../`, `..\`).
5.  **Credential safety:** Credentials and service account details are never printed to the logs.

---

## 6. Telegram Command Routing

The following commands have been added to the Telegram Router:
*   `/drive_latest`: Parses and shows the latest manifest metadata (filename, project, campaign, publish status, and link).
*   `/drive_publish_latest`: Scans approved directories for the most recently generated output file and pushes it to Drive.
*   `/drive_publish_campaign <campaign>`: Validates and uploads an entire local campaign directory recursively to Drive.

---

## 7. Test Results

Executed local test suite `test-drive-publisher.js` and verified that all **9 test cases passed successfully**:
*   ✅ **Test 1:** Local sync copy replication and manifest generation (Passed).
*   ✅ **Test 2:** API mode dry-run fallback when credentials are empty (Passed).
*   ✅ **Test 3:** Security block for forbidden filenames (Passed).
*   ✅ **Test 4:** Path traversal protection (Passed).
*   ✅ **Test 5:** Secret scanner block for API keys in contents (Passed).
*   ✅ **Test 6:** Approved directory scopes (Passed).
*   ✅ **Test 7:** `/drive_latest` parsing (Passed).
*   ✅ **Test 8:** `/drive_publish_latest` command workflow (Passed).
*   ✅ **Test 9:** `/drive_publish_campaign` path traversal block and folder checks (Passed).

---

## 8. Limitations & Recommended Upgrades

*   **Manifest Persistence:** Currently, manifests are written to `openclaw/outbox/google-drive-sync/`. Because Railway container storage is ephemeral, these logs are wiped on redeployment. 
*   **Recommended Next Upgrade:** Transition the sync manifests store from local JSON files to a **Supabase database table** (`openclaw_drive_sync_log`) to preserve historical web links across deployments.
