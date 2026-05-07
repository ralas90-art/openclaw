# Cresca OS Event Runtime

The Event Runtime is the central processing engine for Cresca OS. It follows an asynchronous, event-driven architecture where components communicate by writing to the `event_logs` table in Postgres.

## Architecture

1.  **Event Source:** Any system (Telegram, API, GHL) writes an event to `event_logs` with `status = 'pending'`.
2.  **Polling/Trigger:** The Runtime (currently polling) fetches pending events.
3.  **Status Lock:** The Runtime marks the event as `processing` to avoid duplicate processing.
4.  **Routing:** The `Registry` routes the event to the specific `Handler` based on `event_type`.
5.  **Completion:** The Runtime marks the event as `completed` (with results) or `failed` (with errors).

## Folder Structure

- `/core/events/runtime.js`: The core loop that manages event lifecycles.
- `/core/events/registry.js`: Central mapping of event types to handlers.
- `/core/events/handlers/`: Directory containing specific logic for each event type.

## How to Add a New Event

1.  Register the event type in the `events` table (optional but recommended for schema integrity).
2.  Create a new handler file in `/core/events/handlers/`.
3.  Add the mapping to `/core/events/registry.js`.

## Running the Runtime

```bash
# In a future iteration, this will be a daemon process
node -e "require('./core/events/runtime').processEvents()"
```

## Statuses

- `pending`: Event is waiting to be picked up.
- `processing`: Event is currently being handled.
- `completed`: Event successfully handled.
- `failed`: An error occurred during handling.
