# Workflow: /autoloop setup

## Description
Initializes an optimization loop configuration mapping target metrics, review frequencies, and available skills.

## Inputs required from User
- Project Name
- Optimization Targets
- Metric Sources
- Checkpoint Frequencies

## Execution Steps
1. **Loop Configuration**: Map metric checkpoints to database tables or file paths.
2. **Alert Thresholds**: Define numeric rules that trigger automatic bot alerts.
3. **Invoke Skill**: `auto-loop-system` -> Initialize the optimization loop configuration.
4. **Output**: Generate `compounding-progress-log.md` under `/openclaw/reports/auto-loops/`.
5. **Checkpoint**: Pause for threshold validation review.
