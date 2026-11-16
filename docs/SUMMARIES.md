# Summary data (Phase 10F)

The overview screens (organization dashboard, engagement list and detail, analytics, portfolio) need readiness and finding counts for many engagements at once. Instead of evaluating every checklist item on each page load, the numbers are pre-computed per engagement and stored.

## Tables
- `engagement_summary`: one row per engagement. The evaluated readiness summary (JSON), unresolved / critical / overdue finding counts, `computed_for` (the date the numbers are for) and `computed_at`.
- `summary_dirty`: engagements waiting to be recomputed. Database triggers on every table that feeds readiness (checklist items, control links, statement of applicability, evidence requests, findings, engagements) add a row on any insert, update or delete, whichever code path or raw statement made the change.

## One calculation
`shared/readiness.ts` holds the only implementation of "how ready is this engagement" (with `shared/evaluation.ts`, the rules). The API and the worker both use it, so a stored number and a live number cannot disagree.

## Refresh (worker)
An engagement is recomputed when: it is marked dirty (after a 1.5 second debounce), it has no summary, its summary is from an earlier day (overdue and expiry depend on the date), or it is active and its summary is older than 10 minutes. The dirty mark is removed only if it did not change during the computation, so a change that lands mid-way is picked up next pass.

## Reading (API)
- Stored for today and not dirty: served from the table.
- Missing, from an earlier day, or dirty: computed live at once. The screen is never wrong while the worker catches up.
- A person who sees only their own assigned items always gets live, personal numbers.
- Responses carry `freshness`: `source` (`summary`, `live`, `mixed`), `computedAt`, `ageMinutes`, `stale`. `stale` is true when a served summary is older than 15 minutes, which means the worker is behind or stopped. The screens show "Updated 3 minutes ago" and a "May be out of date" badge.

## Operations
If the badge appears persistently, check the worker container is running and its logs. Nothing needs repair: numbers still come from live computation for anything marked dirty, and the worker back-fills all summaries when it starts.
