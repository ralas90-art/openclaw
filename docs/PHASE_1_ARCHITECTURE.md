# Cresca OS: Phase 1 Architecture

## Overview
Cresca OS is the centralized AI Operating Infrastructure for bilingual SMBs. Phase 1 focuses on establishing the **Event-Driven Multi-Tenant Foundation**.

## System Roles
- **Postgres (Source of Truth):** Every state change, lead record, and tenant configuration lives here. If it's not in Postgres, it didn't happen.
- **GoHighLevel (CRM & Execution):** Handles final communication (SMS/Email) and workflow triggers. It is a downstream consumer of processed leads.
- **Airtable (Visual Ops):** A dashboard for humans to review leads, scores, and automation logs. No business logic should reside here.
- **Manus AI (Intelligence):** The brain used for lead scoring, sentiment analysis, and outreach strategy generation.
- **Telegram (Command Center):** The primary interface for operators to find leads, trigger audits, and monitor system health.

## Directory Structure
- `/core`: The heartbeat of the system.
  - `/tenants`: Tenant isolation and configuration logic.
  - `/events`: Central event bus and standard event types.
  - `/memory`: Contextual operational memory for cross-agent coordination.
  - `/orchestration`: Logic for routing tasks between engines.
  - `/logging`: Unified structured logging across all tenants.
  - `/schemas`: Database and API schemas.
- `/engines`: Specialized AI logic processors.
  - `/lead-intelligence`: Lead finding, enrichment, and scoring.
  - `/speed-to-lead`: Instant response and scheduling logic.
  - `/revenue-ops`: Pipeline health and conversion tracking.
  - `/audit-engine`: GHL and workflow configuration auditing.
- `/integrations`: Wrappers for external APIs.
- `/shared`: Reusable prompts, schemas, and utility functions.

## Development Constraints (Phase 1)
- **NO random automations:** Do not build one-off zaps or hardcoded scripts.
- **Everything is an Event:** Agents must emit events (e.g., `lead.found`) and consume events (e.g., `lead.enrich`).
- **Postgres First:** All data must be written to Postgres before being synced to GHL or Airtable.
