# OpenClaw Bot Registry

Last Updated: 2026-05-23

This registry is the central index of OpenClaw bots, engines, orchestrators, and reusable AI agents.

---

## Active Bots

| Bot Name | Slug | Type | Status | Path | Primary Purpose | Skills / Dependencies |
|---|---|---|---|---|---|---|
| Content Forge | `content-forge` | Bot / Creative Production Orchestrator | Active | `openclaw/bots/content-forge/` | Orchestrates creative campaign production | `google-flow-image-prompt-builder`, `veo-image-to-video-director`, `creative-continuity-bible-builder`, `ad-variant-content-engine`, `video-qa-iteration-auditor`, `platform-repurpose-engine`, `campaign-asset-manifest-builder` |

---

## Planned / Documented Bots

| Bot Name | Slug | Type | Status | Expected Path | Primary Purpose | Notes |
|---|---|---|---|---|---|---|
| Revenue Master Orchestrator | `revenue-master-orchestrator` | Orchestrator | Documented Only | `openclaw/bots/revenue-master-orchestrator/` | Coordinates revenue-generating systems and monetization strategy. | Stub folder exists. Core files pending. |
| System Master Orchestrator | `system-master-orchestrator` | Orchestrator | Documented Only | `openclaw/bots/system-master-orchestrator/` | Coordinates architecture, deployment flows, and cross-bot execution logic. | Stub folder exists. Core files pending. |
| Cresca Content & AEO Engine | `cresca-content-aeo-engine` | Engine | Documented Only | `openclaw/bots/cresca-content-aeo-engine/` | Creates content, AEO assets, schema-rich pages, and authority building content. | Stub folder exists. Core files pending. |
| Lead Acquisition Engine | `lead-acquisition-engine` | Engine | Documented Only | `openclaw/bots/lead-acquisition-engine/` | Builds lead capture systems and prospecting workflows. | Stub folder exists. Core files pending. |
| Revenue Optimization Engine | `revenue-optimization-engine` | Engine | Documented Only | `openclaw/bots/revenue-optimization-engine/` | Audits funnels, offers, and CRM follow-up to stop revenue leakage. | Stub folder exists. Core files pending. |
| Weekly Command Center | `weekly-command-center` | Engine | Documented Only | `openclaw/bots/weekly-command-center/` | Creates weekly operational summaries, KPI reviews, and executive decision support. | Stub folder exists. Core files pending. |
| Client Value Maximizer | `client-value-maximizer` | Engine | Documented Only | `openclaw/bots/client-value-maximizer/` | Improves client onboarding, retention, upsells, and lifecycle value. | Stub folder exists. Core files pending. |
| Auto-Loop System | `auto-loop-system` | Engine | Documented Only | `openclaw/bots/auto-loop-system/` | Creates feedback loops across execution results to continuously optimize campaigns. | Stub folder exists. Core files pending. |

---

## Registry Rules

1. Every OpenClaw bot must be registered here.
2. Active bots must have a real folder path.
3. Planned bots must be clearly marked as `Planned` or `Documented Only`.
4. Do not mark a bot as `Active` unless its core files exist.
5. Every bot should list its connected skills.
6. Every bot should state whether human-in-the-loop checkpoints are required.
7. Every bot should list its known project contexts.
8. Every bot should list applicable safety/compliance gates.
9. Deprecated bots should remain listed for history but marked `Deprecated`.
10. Update this registry whenever a new bot, engine, or orchestrator is created.

---

## Bot Detail Cards

### Content Forge
**Slug:** `content-forge`  
**Type:** Bot / Creative Production Orchestrator  
**Status:** Active  
**Path:** `openclaw/bots/content-forge/`  
**Purpose:** Orchestrates creative campaign production across Google Flow, Gemini/Veo, social ad copy, QA, repurposing, and campaign manifests.  
**Primary Workflows:** `/campaign-start`, `/image-prompts`, `/video-prompt`, `/qa-video`, `/copy-pack`, `/repurpose`, `/finalize-campaign`  
**Connected Skills:**  
- `google-flow-image-prompt-builder`
- `veo-image-to-video-director`
- `creative-continuity-bible-builder`
- `ad-variant-content-engine`
- `video-qa-iteration-auditor`
- `platform-repurpose-engine`
- `campaign-asset-manifest-builder`  
**Known Projects:** SeptiVolt, Cresca OS, G&G Cleaning  
**Human-in-the-loop Required:** Yes  
**Safety / Compliance Gates:** Google AI Safety + Prompt Compliance Gate, Context Resolution Rule, claim-safe marketing language  
**Notes:** Fully active bot implementation exists.

### Revenue Master Orchestrator
**Slug:** `revenue-master-orchestrator`  
**Type:** Orchestrator  
**Status:** Documented Only  
**Path:** `openclaw/bots/revenue-master-orchestrator/`  
**Purpose:** Coordinates revenue-generating systems, offers, campaigns, funnels, sales workflows, and monetization strategy across OpenClaw projects.  
**Primary Workflows:** Pending implementation.  
**Connected Skills:** `offer-engine-builder`, `sales-process-optimizer`, `ghl-revenue-automation-builder`, `client-onboarding-system-builder`  
**Known Projects:** OpenClaw ecosystem  
**Human-in-the-loop Required:** TBD  
**Safety / Compliance Gates:** TBD  
**Notes:** Exists as global skill concept. No local bot implementation yet.

### System Master Orchestrator
**Slug:** `system-master-orchestrator`  
**Type:** Orchestrator  
**Status:** Documented Only  
**Path:** `openclaw/bots/system-master-orchestrator/`  
**Purpose:** Coordinates architecture, infrastructure, reusable skills, deployment flows, system audits, and cross-bot execution logic.  
**Primary Workflows:** Pending implementation.  
**Connected Skills:** `repo-fix-pr-deploy`, `brand-ux-consistency-auditor`, `service-delivery-systemizer`, `publish-github-vercel`  
**Known Projects:** OpenClaw ecosystem  
**Human-in-the-loop Required:** TBD  
**Safety / Compliance Gates:** TBD  
**Notes:** Exists as global skill concept. No local bot implementation yet.

### Cresca Content & AEO Engine
**Slug:** `cresca-content-aeo-engine`  
**Type:** Engine  
**Status:** Documented Only  
**Path:** `openclaw/bots/cresca-content-aeo-engine/`  
**Purpose:** Creates content, AI visibility assets, answer-engine optimization assets, schema-rich pages, FAQs, and authority-building content for Cresca OS and client campaigns.  
**Primary Workflows:** Pending implementation.  
**Connected Skills:** `content-generation-engine`, `notebooklm-research-extractor`, `brand-ux-consistency-auditor`  
**Known Projects:** Cresca OS, client campaigns  
**Human-in-the-loop Required:** TBD  
**Safety / Compliance Gates:** TBD  
**Notes:** Exists as global skill concept. No local bot implementation yet.

### Lead Acquisition Engine
**Slug:** `lead-acquisition-engine`  
**Type:** Engine  
**Status:** Documented Only  
**Path:** `openclaw/bots/lead-acquisition-engine/`  
**Purpose:** Builds lead capture systems, prospecting workflows, scraping/enrichment workflows, outbound assets, scoring, and routing systems.  
**Primary Workflows:** Pending implementation.  
**Connected Skills:** Google Places workflows, OpenAI scoring, Airtable, Telegram, Railway runtime, GHL integrations  
**Known Projects:** OpenClaw ecosystem  
**Human-in-the-loop Required:** TBD  
**Safety / Compliance Gates:** TBD  
**Notes:** Exists as global skill concept. No local bot implementation yet.

### Revenue Optimization Engine
**Slug:** `revenue-optimization-engine`  
**Type:** Engine  
**Status:** Documented Only  
**Path:** `openclaw/bots/revenue-optimization-engine/`  
**Purpose:** Audits funnels, ads, offers, landing pages, CRM follow-up, conversion paths, and revenue leakage.  
**Primary Workflows:** Pending implementation.  
**Connected Skills:** `sales-process-optimizer`, `ghl-config-auditor`, `ghl-revenue-automation-builder`, analytics/audit workflows  
**Known Projects:** OpenClaw ecosystem  
**Human-in-the-loop Required:** TBD  
**Safety / Compliance Gates:** TBD  
**Notes:** Exists as global skill concept. No local bot implementation yet.

### Weekly Command Center
**Slug:** `weekly-command-center`  
**Type:** Engine  
**Status:** Documented Only  
**Path:** `openclaw/bots/weekly-command-center/`  
**Purpose:** Creates weekly operational summaries, KPI reviews, project priorities, bottleneck lists, next actions, and executive-level decision support.  
**Primary Workflows:** Pending implementation.  
**Connected Skills:** project memory, campaign manifests, CRM reports, task logs, NotebookLM summaries  
**Known Projects:** OpenClaw ecosystem  
**Human-in-the-loop Required:** TBD  
**Safety / Compliance Gates:** TBD  
**Notes:** Exists as global skill concept. No local bot implementation yet.

### Client Value Maximizer
**Slug:** `client-value-maximizer`  
**Type:** Engine  
**Status:** Documented Only  
**Path:** `openclaw/bots/client-value-maximizer/`  
**Purpose:** Improves client onboarding, retention, reporting, upsells, service delivery, ROI reporting, and lifecycle value.  
**Primary Workflows:** Pending implementation.  
**Connected Skills:** `client-onboarding-system-builder`, `service-delivery-systemizer`, reporting workflows, GHL workflows  
**Known Projects:** OpenClaw ecosystem  
**Human-in-the-loop Required:** TBD  
**Safety / Compliance Gates:** TBD  
**Notes:** Exists as global skill concept. No local bot implementation yet.

### Auto-Loop System
**Slug:** `auto-loop-system`  
**Type:** Engine  
**Status:** Documented Only  
**Path:** `openclaw/bots/auto-loop-system/`  
**Purpose:** Creates feedback loops across campaigns, execution results, QA reports, analytics, and optimization tasks so the system continuously improves.  
**Primary Workflows:** Pending implementation.  
**Connected Skills:** QA workflows, campaign manifests, analytics reports, task automation, OpenClaw runtime executor  
**Known Projects:** OpenClaw ecosystem  
**Human-in-the-loop Required:** TBD  
**Safety / Compliance Gates:** TBD  
**Notes:** Exists as global skill concept. No local bot implementation yet.
