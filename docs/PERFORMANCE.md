# Performance at 50,000 checklist items (Phase 10H)

`api/test/44_performance.test.ts` seeds one organization with 10 engagements of 5,000 checklist items each (45,000 in the 9 active ones), 500 findings, 2,000 evidence requests and 500 risks, builds the summaries with the worker code, and times each request three times after a warm-up. It fails if the slowest of the three exceeds the budget. Run it alone with `node --import tsx --test test/44_performance.test.ts`; set `PERF_OUT=file.json` to keep the numbers.

## Measured (MariaDB 10.11, one small container, API and database on the same machine; milliseconds, median of 3)
| Screen | Median | Budget |
|---|---|---|
| Dashboard (stored summaries) | 7 | 1,500 |
| Engagement list | 7 | 1,500 |
| Portfolio overview | 13 | 3,000 |
| Analytics (6 months) | 791 | 8,000 |
| Each dashboard tile | 2 to 10 (My work 7) | 1,000 |
| Item list, first page | 960 | 3,000 |
| Item list, page 100 | 986 | 3,000 |
| Item list, overdue only | 280 | 3,000 |
| Item list, awaiting review | 143 | 3,000 |
| Item list, text filter | 40 | 3,000 |
| Item list, vendor (own items only) | 69 | 2,000 |
| Search "perf" | 172 | 4,000 |
| Search across organizations | 16 | 4,000 |
| My Work (vendor with 1,800 items) | 280 | 5,000 |
| Activity timeline | 3 | 1,500 |
| Findings list | 13 | 2,500 |
| Risk register | 16 | 2,500 |
| Worker: compute all 10 summaries | 341 | 30,000 |
| Seeding the data set | about 2,300 | — |

The item list reads and evaluates every matching item for the caller (about 1 second at 45,000 items) before paging, which keeps `total` exact; narrowing filters are applied in the database first. If an organization grows well past this size, the next step is paging in SQL for the states that can be decided from the item row alone.

## One thing to know: database statistics after a bulk load
Right after the 50,000 rows were inserted in one go, the database had not yet refreshed its table statistics and picked poor plans: building the summaries took 32 seconds and the item list 6.9 seconds, against 0.34 and 0.96 seconds once statistics were current. InnoDB refreshes them automatically within minutes of a large change; after a very large import you can do it immediately with `ANALYZE TABLE checklist_items, findings, evidence_requests, checklist_item_controls, soa_entries;` (the test does this after seeding, as production would).

## Not measured here
Production MySQL 8 on separate hardware, network latency, many people at once, and the browser's own rendering time.
