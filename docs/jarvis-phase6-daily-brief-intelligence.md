# Phase 6: Daily Brief Morning Command Intelligence Layer

This document details the configuration, scoring logic, and validation procedures for the Jarvis morning brief intelligence layer.

---

## 🔒 Strictly Read-Only Architecture

As a fundamental security guardrail, **Phase 6 remains 100% read-only**.
* **No write scopes are used**: The application only uses `gmail.readonly` and `drive.metadata.readonly`.
* **No active mutations**: Jarvis will never draft, send, archive, or delete emails, nor will it create, move, share, or delete Google Drive documents.
* **No local file tampering**: The filesystem scanners and suggestion engines do not modify, move, or open any of your local files.

---

## 🧠 Priority Intelligence Scoring Rules

The Priority Intelligence engine combines data across database memory tables (projects, blockers, next actions, mobile uploads) and cloud connector streams (unread emails, recently modified files) into a scored catalog.

Scores are calculated using the following weights:

| Category | Condition / Keyword | Score Modifier |
| :--- | :--- | :--- |
| **Urgency** | Matches `urgent`, `asap`, `immediate`, `critical`, `important`, `urgente`, etc. | **+15** |
| **Client & Project** | Matches the slug or name of an active project | **+10** |
| **High Priority Project** | Matched project has a `high` or `critical` priority flag | **+5** |
| **Payments & Invoicing** | Matches `invoice`, `payment`, `bill`, `pago`, `factura`, `wire`, etc. | **+20** |
| **Deadlines & Dates** | Matches `due`, `deadline`, `soon`, `mañana`, `hoy`, etc. | **+12** |
| **Repeated Mentions** | Project slug appears in multiple feeds (e.g. email + Drive + blocker) | **+10** |
| **Blocker Age** | Blocker is active (base **+10**), plus **+5** per full day active | **+5 / day** (max +30) |
| **Unread Email** | Unread thread in Gmail inbox (base) | **+8** |
| **Mobile Note** | Unprocessed upload in mobile inbox (base **+5**), plus **+8** if from today | **+5** / **+13** |
| **Next Action** | Pending recommended action (high: **+15**, medium: **+10**, normal: **+5**) | **+5** to **+15** |

The Top 3 Priorities for Today are dynamically compiled from the highest-ranking scored items.

---

## 📲 New Telegram Commands

Three new commands are introduced under the **Read-Only Capability Tier**:

1. **`/jarvis_priorities`**
   * **Purpose**: Displays the top 3 scored items for today, showing *why* they were prioritized and their recommended *next action*.
2. **`/jarvis_followups`**
   * **Purpose**: Lists pending client follow-ups compiled from unread actionable emails and unprocessed mobile inbox uploads.
3. **`/jarvis_blockers`**
   * **Purpose**: Lists active project blockers. Stale blockers (active for more than 2 days) are marked with a `⚠️ [STALE]` warning indicator.

The standard **`/jarvis_brief`** is also upgraded to display the `🧠 Jarvis Priority Intelligence` overview at the top of the summary.

---

## 🧪 Fail-Closed Connector Resiliency

If the Gmail or Google Drive connectors are revoked, expired, or unavailable due to API errors, the intelligence layer fails closed gracefully. It logs the warning and compiles the daily brief using local DB tables without crashing.
