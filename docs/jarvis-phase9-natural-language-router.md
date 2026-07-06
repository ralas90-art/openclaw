# Jarvis Phase 9: Natural Language Command Router

## Overview
Phase 9 introduces multilingual natural language routing for Jarvis. It allows users to send natural-sounding text messages in English, Spanish, or a mix of both (Spanglish), mapping these messages directly to established slash commands. 

This phase strictly enforces safety boundaries by preventing state-mutating commands (e.g., approving/rejecting tasks, marking inbox items as processed) from being executed automatically via natural language. These risky actions trigger helpful response cards containing the required explicit slash commands.

## Architecture

### 1. Language Detection & Normalization
- Text is normalized (accents removed, converted to lowercase).
- Detection uses weighted keyword matching to classify messages as `en`, `es`, `mixed`, or `unknown`.

### 2. Intent Aliases
Mapped intents include read-only interactions like:
- **Brief**: "what should i focus on today", "qué tengo pendiente hoy"
- **Priorities**: "show me my priorities", "enséñame mis prioridades"
- **Approvals List**: "show me my pending approvals", "hay aprobaciones pendientes"
- **Outreach Due**: "do i have follow ups due", "tengo seguimientos pendientes"

### 3. Safety Gating
Risky mutations are mapped to `state_mutation` and blocked:
- "aprueba esto", "rechaza esto"
- "manda el mensaje", "envía el email", "contacta este prospecto"
- "reconecta gmail"
- "marca esto como procesado"

When triggered, the router replies in the detected language (e.g. `⚠️ *Acción Bloqueada*` or `⚠️ *Protected Action*`) rather than executing the mutation.

### 4. Secure Audit Logging
Every natural language request is logged to the Supabase `jarvis_natural_language_logs` table with sanitization:
- Raw text is **never** saved directly.
- Secrets (`DATABASE_URL`, `INTERNAL_ADMIN_TOKEN`, URLs with query parameters, etc.) are heavily redacted.
- Text is truncated to 1000 characters maximum.
- `original_text_hash` (SHA-256) is stored for deduplication and debugging.

## Telegram Integration
- **`server.js`** accepts normal text messages (where `isCommand` is false) if authorized.
- **`handlers.js`** intercepts non-slash text messages, routing them through `natural-language-router.js`.
- If mapped to a slash command, execution seamlessly falls through to the existing slash command handlers.
