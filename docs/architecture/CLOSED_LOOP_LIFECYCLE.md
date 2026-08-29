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
