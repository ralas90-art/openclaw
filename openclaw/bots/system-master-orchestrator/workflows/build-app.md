# Workflow: /sys build-app

## 1. Purpose
Plans and templates the frontend UI/UX architecture, component structure, design system, and state management.

## 2. Inputs
- App Name
- Framework (e.g. Next.js, Vite/React)
- Target Layout Description
- Core Dependencies

## 3. Output Format
Detailed folder layout, component relationship graph, Tailwind CSS tokens list, and main routing blueprint.

## 4. Connected Skills
- `brand-ux-consistency-auditor`

## 5. Inbox JSON Structure
```json
{
  "source": "telegram",
  "status": "queued",
  "bot": "system-master-orchestrator",
  "workflow": "build-app",
  "fields": {
    "App Name": "septivolt-dashboard",
    "Framework": "Vite/React",
    "Target Layout": "Sidebar with charts",
    "Core Dependencies": "recharts, tailwind"
  }
}
```

## 6. Outbox Result Location
`/openclaw/reports/system-builds/build-blueprint.md`

## 7. Google Drive Publishing Recommendation
Upload `build-blueprint.md` to `Shared Drive/system-builds/` folder.

## 8. Human-in-the-Loop Checkpoint
Verify color tokens and layout layouts match brand-ux guidelines before generating code.

## 9. Safety / Claim Rules
Ensure no third-party assets are hardcoded. Enforce dependency version locking (`package-lock.json`).

## 10. Example Telegram Command
```text
/sys build_app
App Name: septivolt-dashboard
Framework: Vite/React
Target Layout: Sidebar with charts
Core Dependencies: recharts, tailwind
```
