# Workflow: /sys fix-bug

## 1. Purpose
Diagnoses, traces, and remediates build failures, runtime errors, lint warnings, or CORS issues.

## 2. Inputs
- Error Message / Stack Trace
- Problem File (if known)
- Expected Behavior

## 3. Output Format
Diff block of changes, compiler logs, and verification checklist results.

## 4. Connected Skills
- `repo-fix-pr-deploy`

## 5. Inbox JSON Structure
```json
{
  "source": "telegram",
  "status": "queued",
  "bot": "system-master-orchestrator",
  "workflow": "fix-bug",
  "fields": {
    "Error Message": "CORS error on fetch",
    "Problem File": "server.js",
    "Expected Behavior": "Allow requests from client"
  }
}
```

## 6. Outbox Result Location
`/openclaw/reports/system-builds/bug-fix-walkthrough.md`

## 7. Google Drive Publishing Recommendation
Upload `bug-fix-walkthrough.md` to `Shared Drive/system-builds/` folder.

## 8. Human-in-the-Loop Checkpoint
Run the compiler check locally and check test suite passes before merging any code repairs.

## 9. Safety / Claim Rules
Avoid altering core database schemas without performing a backup snapshot first.

## 10. Example Telegram Command
```text
/sys fix_bug
Error Message: CORS error on fetch
Problem File: server.js
Expected Behavior: Allow requests from client
```
