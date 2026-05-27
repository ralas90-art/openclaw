# OpenClaw Bot Registry

Last Updated: 2026-05-23

This registry is the central index of OpenClaw bots, engines, orchestrators, and reusable AI agents.

---

## Active Bots

| Bot Name | Slug | Type | Status | Path | Primary Purpose | Skills / Dependencies |
|---|---|---|---|---|---|---|
| Content Forge | `content-forge` | Bot / Creative Production Orchestrator | Active | `openclaw/bots/content-forge/` | Orchestrates creative campaign production | `google-flow-image-prompt-builder`, `veo-image-to-video-director`, `creative-continuity-bible-builder`, `ad-variant-content-engine`, `video-qa-iteration-auditor`, `platform-repurpose-engine`, `campaign-asset-manifest-builder` |
| Revenue Master Orchestrator | `revenue-master-orchestrator` | Orchestrator | Active | `openclaw/bots/revenue-master-orchestrator/` | Coordinates revenue-generating systems and monetization strategy. | `offer-engine-builder`, `sales-process-optimizer`, `ghl-revenue-automation-builder`, `client-onboarding-system-builder` |
| System Master Orchestrator | `system-master-orchestrator` | Orchestrator | Active | `openclaw/bots/system-master-orchestrator/` | Coordinates architecture, deployment flows, and cross-bot execution logic. | `repo-fix-pr-deploy`, `brand-ux-consistency-auditor`, `service-delivery-systemizer`, `publish-github-vercel` |
| Cresca Content & AEO Engine | `cresca-content-aeo-engine` | Engine | Active | `openclaw/bots/cresca-content-aeo-engine/` | Creates content, AEO assets, schema-rich pages, and authority building content. | `content-generation-engine`, `notebooklm-research-extractor`, `brand-ux-consistency-auditor` |
| Lead Acquisition Engine | `lead-acquisition-engine` | Engine | Active | `openclaw/bots/lead-acquisition-engine/` | Builds lead capture systems and prospecting workflows. | `lead-acquisition-engine` |
| Revenue Optimization Engine | `revenue-optimization-engine` | Engine | Active | `openclaw/bots/revenue-optimization-engine/` | Audits funnels, offers, and CRM follow-up to stop revenue leakage. | `revenue-optimization-engine`, `ghl-config-auditor`, `ghl-revenue-automation-builder` |
| Weekly Command Center | `weekly-command-center` | Engine | Active | `openclaw/bots/weekly-command-center/` | Creates weekly operational summaries, KPI reviews, and executive decision support. | `weekly-command-center` |
| Client Value Maximizer | `client-value-maximizer` | Engine | Active | `openclaw/bots/client-value-maximizer/` | Improves client onboarding, retention, upsells, and lifecycle value. | `client-value-maximizer`, `client-onboarding-system-builder`, `service-delivery-systemizer` |
| Auto-Loop System | `auto-loop-system` | Engine | Active | `openclaw/bots/auto-loop-system/` | Creates feedback loops across execution results to continuously optimize campaigns. | `auto-loop-system` |

---

## Planned / Documented Bots

*None. All registered bots are currently Active.*

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
**Status:** Active  
**Path:** `openclaw/bots/revenue-master-orchestrator/`  
**Purpose:** Coordinates revenue-generating systems, offers, campaigns, funnels, sales workflows, and monetization strategy across OpenClaw projects.  
**Primary Workflows:** `/revenue system-design`, `/revenue offer-design`, `/revenue ghl-setup`  
**Connected Skills:** `offer-engine-builder`, `sales-process-optimizer`, `ghl-revenue-automation-builder`, `client-onboarding-system-builder`  
**Known Projects:** OpenClaw ecosystem  
**Human-in-the-loop Required:** Yes  
**Safety / Compliance Gates:** Pricing integrity, compliance checks  
**Notes:** Active. Handles core business systems coordination.

### System Master Orchestrator
**Slug:** `system-master-orchestrator`  
**Type:** Orchestrator  
**Status:** Active  
**Path:** `openclaw/bots/system-master-orchestrator/`  
**Purpose:** Coordinates architecture, infrastructure, reusable skills, deployment flows, system audits, and cross-bot execution logic.  
**Primary Workflows:** `/sys build-app`, `/sys deploy`, `/sys fix-bug`  
**Connected Skills:** `repo-fix-pr-deploy`, `brand-ux-consistency-auditor`, `service-delivery-systemizer`, `publish-github-vercel`  
**Known Projects:** OpenClaw ecosystem  
**Human-in-the-loop Required:** Yes  
**Safety / Compliance Gates:** No hardcoded secrets, build and TS checks  
**Notes:** Active. Enforces code standards and automated deployments.

### Cresca Content & AEO Engine
**Slug:** `cresca-content-aeo-engine`  
**Type:** Engine  
**Status:** Active  
**Path:** `openclaw/bots/cresca-content-aeo-engine/`  
**Purpose:** Creates content, AI visibility assets, answer-engine optimization assets, schema-rich pages, FAQs, and authority-building content for Cresca OS and client campaigns.  
**Primary Workflows:** `/aeo optimize-page`, `/aeo faq-schema`  
**Connected Skills:** `content-generation-engine`, `notebooklm-research-extractor`, `brand-ux-consistency-auditor`  
**Known Projects:** Cresca OS, client campaigns  
**Human-in-the-loop Required:** Yes  
**Safety / Compliance Gates:** Claude Copywriting Protocol (MANDATORY Claude for copywriting, no Gemini for public copy)  
**Notes:** Active. Generates high-intent website and visibility copy.

### Lead Acquisition Engine
**Slug:** `lead-acquisition-engine`  
**Type:** Engine  
**Status:** Active  
**Path:** `openclaw/bots/lead-acquisition-engine/`  
**Purpose:** Builds lead capture systems, prospecting workflows, scraping/enrichment workflows, outbound assets, scoring, and routing systems.  
**Primary Workflows:** `/leads icp-define`, `/leads prospect`, `/leads scripts`  
**Connected Skills:** `lead-acquisition-engine`  
**Known Projects:** OpenClaw ecosystem  
**Human-in-the-loop Required:** Yes  
**Safety / Compliance Gates:** Outbound safety thresholds, no spamming  
**Notes:** Active. Sourced prospects must show buying or spending intent.

### Revenue Optimization Engine
**Slug:** `revenue-optimization-engine`  
**Type:** Engine  
**Status:** Active  
**Path:** `openclaw/bots/revenue-optimization-engine/`  
**Purpose:** Audits funnels, ads, offers, landing pages, CRM follow-up, conversion paths, and revenue leakage.  
**Primary Workflows:** `/rev_opt audit`, `/rev_opt speed-lead`  
**Connected Skills:** `revenue-optimization-engine`, `ghl-config-auditor`, `ghl-revenue-automation-builder`  
**Known Projects:** OpenClaw ecosystem  
**Human-in-the-loop Required:** Yes  
**Safety / Compliance Gates:** GHL pipeline integrity  
**Notes:** Active. Prioritizes optimization before scaling acquisition.

### Weekly Command Center
**Slug:** `weekly-command-center`  
**Type:** Engine  
**Status:** Active  
**Path:** `openclaw/bots/weekly-command-center/`  
**Purpose:** Creates weekly operational summaries, KPI reviews, project priorities, bottleneck lists, next actions, and executive-level decision support.  
**Primary Workflows:** `/weekly review`, `/weekly plan`  
**Connected Skills:** `weekly-command-center`  
**Known Projects:** OpenClaw ecosystem  
**Human-in-the-loop Required:** No  
**Safety / Compliance Gates:** Data confidentiality  
**Notes:** Active. Summarizes metrics and sets action items.

### Client Value Maximizer
**Slug:** `client-value-maximizer`  
**Type:** Engine  
**Status:** Active  
**Path:** `openclaw/bots/client-value-maximizer/`  
**Purpose:** Improves client onboarding, retention, reporting, upsells, service delivery, ROI reporting, and lifecycle value.  
**Primary Workflows:** `/client_value upsell`, `/client_value reactivate`, `/client_value referral`  
**Connected Skills:** `client-value-maximizer`, `client-onboarding-system-builder`, `service-delivery-systemizer`  
**Known Projects:** OpenClaw ecosystem  
**Human-in-the-loop Required:** Yes  
**Safety / Compliance Gates:** CAN-SPAM, value-first pricing alignment  
**Notes:** Active. Focuses on extracting more revenue from existing customers.

### Auto-Loop System
**Slug:** `auto-loop-system`  
**Type:** Engine  
**Status:** Active  
**Path:** `openclaw/bots/auto-loop-system/`  
**Purpose:** Creates feedback loops across campaigns, execution results, QA reports, analytics, and optimization tasks so the system continuously improves.  
**Primary Workflows:** `/autoloop review`, `/autoloop setup`  
**Connected Skills:** `auto-loop-system`  
**Known Projects:** OpenClaw ecosystem  
**Human-in-the-loop Required:** No  
**Safety / Compliance Gates:** System loop fail-safes  
**Notes:** Active. Continuously optimizes system performance based on metrics.
