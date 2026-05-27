# Workflow: /weekly plan

## 1. Purpose
Establishes the weekly growth focus areas, targets KPIs, and details task assignments with owners.

## 2. Inputs
- Primary Target KPI (e.g. Increase demo shows)
- Team Member Names & Roles
- Expected Deliverables

## 3. Output Format
Prioritized weekly checklists, team owner assignments table, timeline milestones, and KPI goals numbers.

## 4. Connected Skills
- `weekly-command-center`

## 5. Inbox JSON Structure
```json
{
  "source": "telegram",
  "status": "queued",
  "bot": "weekly-command-center",
  "workflow": "plan",
  "fields": {
    "Primary Target": "Increase demo shows",
    "Team Members": "John (sales), Alice (dev)",
    "Expected Deliverables": "Setup SMS reminders"
  }
}
```

## 6. Outbox Result Location
`/openclaw/reports/weekly-summaries/weekly-execution-plan.md`

## 7. Google Drive Publishing Recommendation
Upload `weekly-execution-plan.md` to `Shared Drive/weekly-summaries/` folder.

## 8. Human-in-the-Loop Checkpoint
Verify task capacity with the respective team members before freezing the weekly milestones checklist.

## 9. Safety / Claim Rules
Tasks must represent realistic operational parameters. Do not overload milestones checklists.

## 10. Example Telegram Command
```text
/weekly plan
Primary Target: Increase demo shows
Team Members: John (sales), Alice (dev)
Expected Deliverables: Setup SMS reminders
```
