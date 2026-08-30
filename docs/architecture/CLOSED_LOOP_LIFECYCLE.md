# Closed-Loop Lifecycle

1. A prospect is created or discovered.
2. Qualification can promote a prospect to an opportunity.
3. The Opportunity Command Center opens an opportunity by ID, including direct hash URLs.
4. The API builds deal intelligence from persisted opportunity, linked prospect, activity, and tasks.
5. A user performs an explicit action such as adding contact data, setting value, creating follow-up, or creating the recommended task.
6. The action validates inputs, performs duplicate-safe persistence, writes activity/tasks/opportunity changes, recalculates intelligence, and returns refreshed state.
7. The UI updates from the response and refreshes intelligence without manual reload.
8. The Opportunity Intelligence portfolio refreshes its revenue read model after the Command Center callback; selecting a ranked portfolio action opens the same hash-routed Command Center and Back returns to the portfolio.

The loop is only healthy if UI, API, persistence, activity, tasks, and deterministic intelligence all reflect the same mutation.

## Opportunity Execution Engine
9. A user may materialize the current deterministic recommendation as a persisted RevenueAction snapshot.
10. TGE prepares a deterministic communication draft or internal-task proposal; a human explicitly approves or rejects it.
11. Manual communication is only confirmed by the user; TGE never sends it. Internal task execution writes/reuses a linked CRM task and activity.
12. The action records its audit trail and linked records, returns refreshed opportunity/pipeline/revenue intelligence, and the Command Center refreshes its lifecycle/history state.
13. If CRM evidence changes before preparation or execution, the action is cancelled as stale and a fresh recommendation must be materialized.
