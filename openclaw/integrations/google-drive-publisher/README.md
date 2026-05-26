# OpenClaw Google Drive Publisher

The Google Drive Publisher integration automatically duplicates generated content outputs, campaign briefs, visual prompts, and reports to Google Drive. This enables quick access from mobile devices and allows working on content assets from the Telegram bot.

---

## Architecture Overview

The system supports two environment-specific publishing modes:

### 1. Local Mode (`local`)
*   **Usage:** For local laptops/development environments where Google Drive for Desktop is installed.
*   **Behavior:** Copies files using standard filesystem operations directly into the Drive-synced folder structure.
*   **Path Variable:** `GOOGLE_DRIVE_LOCAL_ROOT` (e.g., `G:\My Drive\OpenClaw` or `C:\Users\12132\Google Drive\OpenClaw`).

### 2. API Mode (`api`)
*   **Usage:** For cloud environments (e.g., Railway production).
*   **Behavior:** Uploads files programmatically to Google Drive using the Google Drive API.
*   **Folder Variable:** `GOOGLE_DRIVE_OUTPUT_FOLDER_ID` (target parent folder in Google Drive).
*   **Credentials Variable:** `GOOGLE_DRIVE_CREDENTIALS_BASE64` (Base64-encoded Service Account JSON key).

---

## Directory Structure in Google Drive

The publisher organizes files into a clean structure inside the target Google Drive root folder:

```text
OpenClaw/
├── Telegram Requests/
├── Telegram Responses/
├── Campaigns/
│   ├── SeptiVolt/
│   ├── Cresca OS/
│   └── G&G Cleaning/
├── Reports/
└── Manifests/
```

---

## Configuration Variables

Add the following to your local `.env` file or your Railway environment settings:

```ini
# Google Drive Publisher Setup
GOOGLE_DRIVE_PUBLISH_MODE=local
GOOGLE_DRIVE_LOCAL_ROOT="G:\My Drive\OpenClaw"

# Railway Production Setup
# GOOGLE_DRIVE_PUBLISH_MODE=api
# GOOGLE_DRIVE_OUTPUT_FOLDER_ID=1a2b3c4d5e6f7g8h9i0j...
# GOOGLE_DRIVE_CREDENTIALS_BASE64=eyJhY2NvdW50X2tleSI...
# GOOGLE_DRIVE_ALLOW_INTERNAL_DOC_PUBLISH=false
```
