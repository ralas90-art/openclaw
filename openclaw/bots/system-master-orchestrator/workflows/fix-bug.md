# Workflow: /sys fix-bug

## Description
Diagnoses, traces, and remediates build failures, runtime errors, lint warnings, or CORS issues.

## Inputs required from User
- Error Message / Stack Trace
- Problem File (if known)
- Expected Behavior

## Execution Steps
1. **Self-Annealing Loop**: Analyze the logs, trace file references, and identify root cause.
2. **Implement Fix**: Apply localized file changes to resolve the failure.
3. **TypeScript/Build Validation**: Re-run the compiler to verify compilation success.
4. **Invoke Skill**: `repo-fix-pr-deploy` -> Document the solution and diff structure.
5. **Output**: Generate `bug-fix-walkthrough.md` under `/openclaw/reports/system-builds/`.
6. **Checkpoint**: Pause for fix verification confirmation.
