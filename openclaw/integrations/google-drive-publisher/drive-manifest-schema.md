# Google Drive Publish Manifest Schema

For every file publication attempt (successful, failed, or dry-run), a manifest log is saved to `openclaw/outbox/google-drive-sync/` in JSON format.

---

## Schema Structure

```json
{
  "source": "openclaw",
  "published_to": "google_drive",
  "status": "published | dry_run | failed",
  "publish_mode": "local | api",
  "local_file": "relative/path/to/local/file",
  "drive_file_id": "google-drive-unique-file-id (API mode only)",
  "drive_web_url": "https://drive.google.com/... (API mode only)",
  "drive_local_path": "local/absolute/copy/path (Local mode only)",
  "drive_folder_id": "google-drive-parent-folder-id (API mode only)",
  "published_at": "ISO-8601-Timestamp",
  "project": "ProjectName",
  "campaign": "CampaignName",
  "bot": "BotName",
  "workflow": "WorkflowName",
  "error": "Error description if failed"
}
```
