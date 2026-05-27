# Workflow: /sys deploy

## Description
Coordinates GitHub branch synchronization, PR creations, build validations, and Netlify/Vercel deployments.

## Inputs required from User
- Repository URL
- Target Branch (e.g. staging, master)
- Host Provider (e.g. Netlify, Vercel, Railway)

## Execution Steps
1. **Build Validation**: Run TypeScript compilation and `npm run build` locally.
2. **Environment Audit**: Check that `.env` configs exist and `.gitignore` blocks credentials.
3. **Invoke Skill**: `publish-github-vercel` or `repo-fix-pr-deploy` -> Push code to target origin and track deploy URL.
4. **Smoke Test**: Navigate staging routes using browser tools to verify console cleanliness.
5. **Output**: Generate `deployment-smoke-test-report.md` under `/openclaw/reports/system-builds/`.
6. **Checkpoint**: Pause for production release approval.
