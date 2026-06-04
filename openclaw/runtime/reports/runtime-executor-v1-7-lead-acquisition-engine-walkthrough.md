# OpenClaw Runtime Executor v1.7 — Add Lead Acquisition Engine Runtime Bot Walkthrough

## Overview
OpenClaw Runtime Executor v1.7 introduces `lead-acquisition-engine` as the third approved runtime bot. This bot handles lead generation planning, targeting strategies, briefs, scripts, and qualification frameworks. 

To satisfy the v1.7 constraints, a strict prompt security boundary has been implemented ensuring the bot remains strictly output-only (prohibiting scraping, external API requests, or GHL CRM syncing).

---

## 📄 Files Changed
1. **[runtime-allowlist.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-allowlist.js)**: Added `'lead-acquisition-engine'` to approved bots array.
2. **[registry.md](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/bots/registry.md)**: Promoted the bot to Active Runtime and updated its status.
3. **[runtime-executor.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/openclaw/runtime/runtime-executor.js)**: Configured the prompt safety boundary for v1.7 executions.
4. **[handlers.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/interfaces/telegram/handlers.js)**: Updated `/help` commands listing and examples.
5. **[test-activated-bots.js](file:///c:/Users/12132/.gemini/antigravity/playground/primal-astro/testing/test-activated-bots.js)**: Updated test routing assertions to verify lead-acquisition-engine executes under runtime dispatch rules.

---

## 🔒 Prompt Safety Boundary
The `lead-acquisition-engine` system prompt incorporates the following explicit boundary:
```
LEAD ACQUISITION SAFETY BOUNDARY (v1.7):
- The bot must remain strictly output-only.
- Allowed: Generate strategy documents, lead acquisition plans, research briefs, GHL pipeline implementation plans, cold outreach scripts, qualification frameworks, and Google Places research criteria.
- Strictly Forbidden: Do not call Google Places API, do not scrape websites, do not enrich leads, do not send emails, do not send SMS, do not create GHL contacts, do not create GHL opportunities, do not write to Airtable, do not trigger external automations, and do not execute outbound actions.
```

---

## 🧪 Verification & Test Results
All test suites ran successfully and are 100% green:

### 1. Runtime Executor Test Suite (97/97 tests passed)
`OPENCLAW_MODEL_PROVIDER=mock node scratch/test-runtime-executor.js`
```
🧪 Starting OpenClaw Runtime Executor Test Suite...
...
✅ Test PASSED: Test 86: lead-acquisition-engine is included in the runtime allowlist
✅ Test PASSED: Test 87: /run_bot lead-acquisition-engine <request> works in mock mode
✅ Test PASSED: Test 88: /run_publish lead-acquisition-engine <request> publishes the exact generated file
✅ Test PASSED: Test 89: /run_by_bot lead-acquisition-engine returns recent jobs
✅ Test PASSED: Test 90: /run_search lead-acquisition-engine finds jobs
✅ Test PASSED: Test 91: /run_job <job_id> works for a Lead Acquisition Engine job
✅ Test PASSED: Test 92: Lead Acquisition Engine output includes the v1.7 safety boundary
✅ Test PASSED: Test 93: Unknown bot behavior still works
✅ Test PASSED: Test 94: Existing revenue-master-orchestrator runtime still works
✅ Test PASSED: Test 95: Existing content-forge runtime still works
✅ Test PASSED: Test 96: Existing exact-file publishing behavior still works
✅ Test PASSED: Test 97: Existing job index/search behavior still works
✅ Test PASSED: Test 98: Existing Drive publisher tests still pass

📊 Runtime Executor Tests (v1.7): 97 | ✅ Passed: 97 | ❌ Failed: 0
```

### 2. Activated Bot Routing Tests (`node testing/test-activated-bots.js`)
- **Result:** `ALL BOT ROUTING & STATUS TESTS PASSED SUCCESSFULLY!`

### 3. Drive Publisher Tests (`node scratch/test-drive-publisher.js`)
- **Result:** `Tests Run: 12 | Passed: 12 | Failed: 0`

---

## 🔮 Recommendation for v1.8
1. **API Integration planning:** Design modular REST call schemas to connect Google Places scraper wrappers safely, behind user-approved dry-run review steps.
2. **Contact sync schema mapping:** Map target contact JSON structures to prepare GHL endpoint payloads.
