# Event System Model

## Core Philosophy
Cresca OS uses a strictly asynchronous, event-driven architecture. Components do not call each other directly; they publish events to a shared bus and subscribe to topics.

## Event Schema
All events must follow the standard structure:
```json
{
  "event_id": "uuid",
  "tenant_id": "tenant_uuid",
  "timestamp": "iso8601",
  "topic": "lead.intelligence",
  "action": "found",
  "payload": { ... },
  "metadata": {
    "source": "google_places",
    "version": "1.0"
  }
}
```

## Flow Example: Lead Generation
1. **Telegram Integration** emits `command.received` (payload: `/findleads roofing`).
2. **Orchestrator** consumes `command.received` and emits `lead.search.requested`.
3. **Lead Intelligence Engine** consumes `lead.search.requested`, fetches data, and emits `lead.found` for each business.
4. **Manus AI Integration** consumes `lead.found`, scores the lead, and emits `lead.scored`.
5. **Postgres Integration** consumes `lead.scored` and saves the final state.
6. **Airtable Sync** consumes `lead.scored` and updates the visual UI.
7. **Telegram Integration** consumes `lead.scored` and replies to the user.

## Implementation Rules
- **Emit Everything:** Even if no one is listening yet, emit the event.
- **Idempotency:** Consumers must handle the same event multiple times without side effects (state is checked in Postgres).
- **Tenant Isolation:** Every event MUST have a `tenant_id`.
