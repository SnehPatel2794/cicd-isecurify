# Risk register (Phase 9B)

## Rating
Likelihood and impact are each 1 to 5; score = likelihood x impact. 1-4 low, 5-9 medium, 10-16 high, 17-25 critical. A risk has an **inherent** rating (before treatment) and optionally a **residual** rating (what remains). Heat maps count every risk that is not closed; the residual map uses the residual rating where one exists, else the inherent one.

## Who can do what
| Action | Who |
|---|---|
| See the register | client admins, auditors, managing iSecurify staff; client staff and vendors see only risks they own (others are "not found") |
| Log a risk, change what it is or its inherent rating | client admins, auditors, managing staff |
| Set owner and review date | client admins, managing staff |
| Choose treatment, write the plan, residual rating, start treatment | the owner, client admins, managing staff |
| Accept a risk | client admins, managing staff, **never the owner** |
| Close a risk | client admins, auditors, managing staff, never the owner |
| Reopen | owner, client admins, managing staff, auditors (note required) |

## Lifecycle
identified -> treating (needs a treatment other than accept, and a plan) | accepted | closed; treating -> identified | accepted | closed; accepted -> identified | closed; closed -> identified.
- **Accept:** note, residual rating, and a review date in the future and within 365 days. The treatment becomes "accept".
- **Close:** note; a mitigated risk also needs its residual rating.
- An accepted risk cannot be re-rated or re-treated until it is reopened, so a changed rating is always accepted again. Closed risks are frozen (reopen first).
- An accepted risk whose review date has passed is flagged "review overdue" (register, analytics, portfolio attention list).

## Links
A risk can be linked to findings and to checklist items of the same organization (each once). Links can be removed; every link change is recorded. `GET /t/:id/findings/:findingId/risks` lists the risks that point at a finding.

## Records
`risks` are never deleted and keep their number and creator; `risk_events` (created, edited, rated, assigned, status, link, unlink, comment) are append-only. Risk numbers (R-001) are per organization. The database also enforces the rating scales, the residual pair, closed-at consistency, and the accepted-risk requirements. People who own open risks cannot be deleted until the risks are reassigned or dealt with. Audit: `risk.created/updated/status/linked/unlinked`.
Notifications: `risk.assigned` (owner), `risk.decision` (owner, when someone else accepts, closes or reopens). Reminders for overdue acceptance reviews are not sent by email yet; they show in the screens.
