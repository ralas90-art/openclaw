# Workflow: /leads icp-define

## Description
Builds a detailed Ideal Customer Profile (ICP) defining target industries, sizes, marketing behaviors, and pain points.

## Inputs required from User
- Brand Name
- Target Industry
- Core Value Proposition
- Target Location

## Execution Steps
1. **ICP Synthesis**: Combine firmographic variables, spending signals, and pain points.
2. **Channel Selection**: Identify matching sourcing channels (e.g. Google Maps, ad registries, directories).
3. **Invoke Skill**: `lead-acquisition-engine` -> Generate the standardized ICP definition.
4. **Output**: Generate `prospect-icp-profile.md` under `/campaigns/{brand}/lead-acquisition/`.
5. **Checkpoint**: Pause for target channel and profiling sign-off.
