# Lead Intelligence Engine V1

The Lead Intelligence Engine is responsible for analyzing incoming leads and generating actionable data (scores, grades, and strategies) to drive the sales process.

## V1 Capabilities (Deterministic)

In Phase 1, the engine uses a deterministic scoring model based on data completeness and keyword matching:

-   **Data Completeness:** Points for phone, email, and location.
-   **Service Specificity:** Points for identifying a specific service type.
-   **Urgency Detection:** High points for keywords like "emergency", "leak", "broken", or "ASAP".
-   **Output:** Generates a numerical score (0-100), a letter grade (A-D), and an outreach recommendation.

## Workflow

1.  **Trigger:** Listens for `lead.created` events.
2.  **Analysis:** Fetches the lead record and runs the `scoring.js` logic.
3.  **Persistence:** Saves analysis to the `lead_intelligence` table.
4.  **Notification:** Emits a `lead.scored` event for downstream engines (e.g., Speed-to-Lead).

## Scoring Tiers

-   **Grade A (90+):** Emergency or high-intent leads. Requires <5 min response.
-   **Grade B (75-89):** Solid leads with complete contact info.
-   **Grade C (50-74):** Standard leads.
-   **Grade D (<50):** Low-quality or missing contact information.

## Roadmap to V2

-   **Manus AI Integration:** Use LLMs for deep sentiment analysis and contextual scoring.
-   **Scraping:** Enrich business leads with website and social data.
-   **Multi-Lingual:** Support for Spanish/English sentiment analysis.
