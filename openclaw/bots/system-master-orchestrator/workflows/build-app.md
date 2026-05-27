# Workflow: /sys build-app

## Description
Plans and templates the frontend UI/UX architecture, component structure, design system, and state management.

## Inputs required from User
- App Name
- Framework (e.g. Next.js, Vite/React)
- Target Layout Description
- Core Dependencies

## Execution Steps
1. **B.L.A.S.T - Blueprint**: Outline the file tree, layout wrappers, and state contexts.
2. **Logic Check**: List reusable component slots, Tailwind tokens, and asset imports.
3. **Route**: Trigger styling system templates under `index.css` or theme variables.
4. **Invoke Skill**: `brand-ux-consistency-auditor` -> Enforce brand guidelines.
5. **Output**: Generate `build-blueprint.md` under `/openclaw/reports/system-builds/`.
6. **Checkpoint**: Pause for UI layout verification.
