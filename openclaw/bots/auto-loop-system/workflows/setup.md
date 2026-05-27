# Workflow: /autoloop setup

## 1. Purpose
Initializes an optimization loop configuration mapping target metrics, review frequencies, and available skills.

## 2. Inputs
- Project Name
- Optimization Targets
- Metric Sources
- Checkpoint Frequencies

## 3. Output Format
Metric mapping definitions, trigger threshold parameters, and progress logs template.

## 4. Connected Skills
- `auto-loop-system`

## 5. Inbox JSON Structure
```json
{
  "source": "telegram",
  "status": "queued",
  "bot": "auto-loop-system",
  "workflow": "setup",
  "fields": {
    "Project Name": "Cresca OS Leads",
    "Optimization Targets": "speed-to-lead response time",
    "Metric Sources": "GHL pipeline logs",
    "Checkpoint Frequencies": "weekly"
  }
}
```

## 6. Outbox Result Location
`/openclaw/reports/auto-loops/compounding-progress-log.md`

## 7. Google Drive Publishing Recommendation
Upload `compounding-progress-log.md` to `Shared Drive/auto-loops/` folder.

## 8. Human-in-the-Loop Checkpoint
Confirm targets and threshold bounds with project director before monitoring activation.

## 9. Safety / Claim Rules
Avoid tracking personal contact data. Only aggregate global statistics to preserve privacy compliance.

## 10. Example Telegram Command
```text
/autoloop setup
Project Name: Cresca OS Leads
Optimization Targets: speed-to-lead response time
Metric Sources: GHL pipeline logs
Checkpoint Frequencies: weekly
```
