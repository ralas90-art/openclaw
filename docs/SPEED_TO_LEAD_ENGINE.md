# Speed-to-Lead Engine V1

The Speed-to-Lead Engine is the operational decision-maker of Cresca OS. It takes intelligence data (scores/grades) and determines the optimal response strategy, timing, and priority.

## Core Responsibilities

1.  **Prioritization:** Assigns a priority level (Critical, High, Medium, Low) based on lead score and urgency.
2.  **Timing:** Recommends a response window (e.g., 5 minutes for Critical leads).
3.  **Strategy Selection:** Decides the best channel sequence (e.g., SMS Immediate -> Call Followup).
4.  **Workflow Management:** Tracks the decision process in the `workflow_runs` table.

## V1 Deterministic Strategy

-   **Critical (Grade A / Score 90+):** 5-minute response window. Strategy: `sms_immediate_call_followup`.
-   **High (Grade B / Score 75-89):** 30-minute response window. Strategy: `sms_immediate_call_followup`.
-   **Medium (Grade C / Score 50-74):** 2-hour response window. Strategy: `sms_delayed`.
-   **Low (Grade D / Score <50):** 24-hour response window. Strategy: `email_drip`.

## Events Emitted

-   `outreach.recommended`: Triggered for all actionable leads. Contains the full strategy payload.
-   `high_value_lead`: Triggered for Grade A/B leads to alert managers or high-priority queues.
-   `followup.required`: Creates a scheduled task/reminder in the system.

## Integration Path

This engine is the "brain" that will eventually tell the **GHL Engine** or **Telegram Engine** exactly what to send and when.
