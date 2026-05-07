# Cresca OS Telegram Alert Layer

The Telegram Alert Layer provides real-time operational visibility into Cresca OS events. It allows operators to receive instant notifications when high-priority leads are identified or when specific outreach strategies are recommended.

## Components

### 1. Telegram Client (`/integrations/telegram/client.js`)
A lightweight wrapper around the Telegram Bot API using `axios`.
- `sendMessage(text)`: Sends an HTML-formatted message to the configured chat.

### 2. Message Formatter (`/integrations/telegram/formatter.js`)
Transforms raw event data into human-readable, actionable alerts.
- `formatOutreachRecommended`: Detailed strategy alert.
- `formatHighValueLead`: Critical priority alert.
- `formatFollowupRequired`: SLA/Follow-up reminder.

### 3. Event Handlers
The layer listens for specific events emitted by the Speed-to-Lead engine:
- `outreach.recommended` -> `handlers/outreachRecommended.js`
- `high_value_lead` -> `handlers/highValueLead.js`
- `followup.required` -> `handlers/followupRequired.js`

## Configuration

Required environment variables in `.env`:
- `TELEGRAM_BOT_TOKEN`: Your BotFather token.
- `TELEGRAM_CHAT_ID`: The target chat or group ID.

## Alert Format Example

**🚀 Outreach Recommended**
**Tenant:** Demo Corp
**Lead:** John Doe
**Score:** 9/10 (Grade A)
**Strategy:** immediate_sms_call
**Priority:** critical
**Action:** Send SMS and initiate voice call within 5 mins.

## Execution Flow

1. **Event Trigger:** Speed-to-Lead engine emits `outreach.recommended`.
2. **Runtime Dispatch:** The Event Runtime detects the event and calls the corresponding handler.
3. **Formatting:** The handler calls the Formatter to generate the message.
4. **Delivery:** The handler calls the Telegram Client to send the message.
5. **Audit:** A `telegram.alert_sent` event is emitted to Postgres for auditing purposes.

## Testing

Run the full-chain test:
```bash
node scripts/test-telegram-alerts.js
```
This script creates a test lead, runs it through the intelligence and speed-to-lead engines, and triggers the Telegram alerts.
