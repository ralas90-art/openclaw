# Google Drive Publisher Developer Specification

This document details the library APIs, security rules, and publishing logic for the OpenClaw Google Drive Publisher.

---

## Publisher APIs

The publisher exposes four core functions:

### 1. `publishFileToDrive(filePath, options)`
Duplicates a single local file to the mapped Google Drive location based on its relative path and campaign settings.
*   **Arguments:**
    *   `filePath`: Absolute or relative path to the local file.
    *   `options`: Object containing optional metadata:
        *   `project`: Project name (e.g., `SeptiVolt`).
        *   `campaign`: Campaign folder name (e.g., `Batch 001 Founder Demo Ad`).
        *   `bot`: Bot identifier (e.g., `content-forge`).
        *   `workflow`: Active workflow name (e.g., `image-prompts`).
*   **Returns:** A Promise resolving to the publish manifest result.

### 2. `publishFolderToDrive(folderPath, options)`
Publishes all valid files inside a folder to Google Drive recursively.
*   **Arguments:**
    *   `folderPath`: Path to the local folder.
    *   `options`: Formatting option parameters.

### 3. `publishCampaignToDrive(campaignPath, options)`
Specifically uploads all generated assets from a campaign directory (Briefs, Image Prompts, Captions, and generated images) to the matching campaign subdirectory in Google Drive.
*   **Arguments:**
    *   `campaignPath`: Absolute or relative path of the campaigns folder.

### 4. `createDrivePublishManifest(result)`
Saves a standardized JSON manifest to `openclaw/outbox/google-drive-sync/` to track upload history and generate URLs.

---

## Security Guardrails

To prevent data leaks, credential exposure, or path-traversal attacks, the publisher implements the following validation rules:

### 1. Approved Source Directories
Files can only be published from:
*   `openclaw/outbox/`
*   `openclaw/reports/`
*   `campaigns/`

Files originating from any other directory (e.g., root folder, `openclaw/bots/`, or `openclaw/integrations/`) are **blocked** by default unless the override flag is explicitly enabled:
*   `GOOGLE_DRIVE_ALLOW_INTERNAL_DOC_PUBLISH=true`

### 2. Forbidden File Names
The following file names and patterns are explicitly blocked from upload:
*   `.env` (and any variant like `.env.local`)
*   `.key`, `.pem`, `.p12` (private key files)
*   `credentials.json`, `token.json`
*   Any path containing `node_modules` or Git metadata.

### 3. Automatic Secret Content Scanning
Before uploading, files are scanned for potential API tokens or private credentials. The upload will be aborted if any of the following strings appear in the file:
*   `TELEGRAM_BOT_TOKEN`
*   `TELEGRAM_WEBHOOK_SECRET`
*   `OPENAI_API_KEY`
*   `ELEVENLABS_API_KEY`
*   `SUPABASE_SERVICE_ROLE_KEY`
*   `GOOGLE_DRIVE_CREDENTIALS`
*   `-----BEGIN PRIVATE KEY-----`

### 4. Path Traversal Mitigation
Any file path containing parent directory markers (`../` or `..\`) is immediately rejected.
