# Workflow: /sys deploy

## 1. Purpose
Coordinates GitHub branch synchronization, PR creations, build validations, and Netlify/Vercel deployments.

## 2. Inputs
- Repository URL
- Target Branch (e.g. staging, master)
- Host Provider (e.g. Netlify, Vercel, Railway)

## 3. Output Format
Detailed deploy logs, compiled output stats, sitemap checks, and staging smoke test checks.

## 4. Connected Skills
- `publish-github-vercel`
- `repo-fix-pr-deploy`

## 5. Inbox JSON Structure
```json
{
  "source": "telegram",
  "status": "queued",
  "bot": "system-master-orchestrator",
  "workflow": "deploy",
  "fields": {
    "Repository URL": "https://github.com/org/repo",
    "Target Branch": "staging",
    "Host Provider": "Netlify"
  }
}
```

## 6. Outbox Result Location
`/openclaw/reports/system-builds/deployment-smoke-test-report.md`

## 7. Google Drive Publishing Recommendation
Upload `deployment-smoke-test-report.md` to `Shared Drive/system-builds/` folder.

## 8. Human-in-the-Loop Checkpoint
Wait for manual link validation and browser console verification before triggering production release.

## 9. Safety / Claim Rules
Enforce secret scanning on branch. Ensure `.env` is never added to remote commits.

## 10. Example Telegram Command
```text
/sys deploy
Repository URL: https://github.com/org/repo
Target Branch: staging
Host Provider: Netlify
```
