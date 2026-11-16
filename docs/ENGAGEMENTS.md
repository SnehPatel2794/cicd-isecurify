# Engagements, checklist, SOA, evaluation (Phase 4)

## Data model (all tenant-owned; composite keys)
`engagements` (tenant_id, id) → `engagement_frameworks` (which **release** of which framework; one primary), `engagement_members` (lead / team / auditor), `phase_logs` (5 rows), `checklist_items`, `checklist_item_controls` (the "satisfies" links), `soa_entries`, `engagement_milestones`, `discovery_responses`.
Global content: `process_templates` (+ milestones, optional path filter), `discovery_questions`.
Database-enforced rules (tested with raw SQL): a child row can never reference another tenant's parent (composite FKs); a control link carries the **same engagement** as its item; a release must belong to the stated framework; one primary framework and one lead per engagement; a control is linked at most once per engagement; SOA "not applicable" and checklist "not applicable" need a non-blank justification (CHECK); phase 1–5; end date not before start date; engagements and their history cannot be deleted (ON DELETE RESTRICT).

## Creating an engagement (one transaction)
Inputs: one or more **published** releases (one per framework, primary first), optional audit path. Steps: engagement row → framework links (the exact release ids are stored) → 5 phase logs (phase 1 in progress) → for each release, apply controls → milestones from the frameworks' templates (or the default template) filtered by audit path → lead (creator if iSecurify staff).
**Merge rule:** a control whose common control is already represented by an item in this engagement adds a *link* instead of a duplicate item. Controls without a common control always get their own item. SOA entries (default applicable) are created for **every** control of every framework, so the SOA stays complete even when items are merged.
The **overlap preview** returns the same numbers before anything is created (tested to match).
Later framework releases and later mapping edits never change an existing engagement (tested by comparing snapshots).
An audit path is required only when a selected framework's template has path-specific milestones (e.g. SOC 2 Type I/II).

## Control-evaluation service (`modules/engagements/evaluation.ts`)
Pure, deterministic, no I/O. The only place readiness/compliance status is computed. Inputs: the **claim** (readiness, set by people) and the **validation** (evidence status, set only by the auditor workflow in Phase 5).
Precedence: Not applicable (declared N/A, or every satisfied control N/A in the SOA) → claim ceiling (not started → *not assessed*, in progress → *not implemented*, partially → *partially implemented*) → only "implemented" is checked against evidence: accepted → **effective**; submitted → *awaiting review*; rejected → *ineffective*; collecting → *implemented, pending validation*; none requested → *blocked: missing evidence*; accepted but expired → *blocked*.
A file never makes a control effective, and accepted evidence does not lift a control that is not claimed implemented. "Effective" is a readiness measure, **not** an external certification.
Readiness % = effective ÷ applicable (N/A excluded), one decimal. The exhaustive test covers all 5 × 6 × 2 × 2 input combinations against an independently written table. Lists, engagement pages and dashboards all call this service (tested to agree).

## Who sees what
| Role | Engagements | Checklist | Other tabs |
|---|---|---|---|
| client_admin | all in their organization | all items | all; creates engagements, assigns, edits SOA/phases/milestones/discovery |
| client_staff, vendor | only where they hold assigned items | **only their own items** | none (403) |
| tp_auditor | only engagements they are a member of | all items | read SOA/team/discovery/activity; cannot edit |
| iSecurify staff (assigned to the organization) | all in that organization | all items | `can_manage` = edit; **advance phase / close / manage team** need manage |
Accountable people may change only the **readiness** of their own item (never N/A, dates, assignment). Closed engagements are read-only (409 `engagement_closed`).

## Not in this phase
Evidence request/submit/review and expiry (Phase 5: sets `evidence_status`), findings (6), notifications (7), reports (8), read-model dashboards and search (9). Until Phase 5 every item's evidence status stays `not_requested`, so "implemented" items show as *blocked: missing evidence*: that is the correct, conservative answer.

## Lifecycle (Phase 11C)

**Phase-advance checks.** `GET /t/:tid/engagements/:id/phase-check` lists what is outstanding for the current phase. A *block* (for example an empty checklist in phase 1) stops the advance. A *warning* (unassigned controls, overdue items, items awaiting review, unresolved findings, open milestones) can be accepted: `POST .../advance-phase` with `{acknowledge: true, note}` (note of at least 5 characters). Without it the call answers 409 `phase_warnings`. The acknowledged codes and the note are kept in the audit trail (`phase.advanced`).

**Auditor sign-off** (`modules/signoff`). Phase 5 only. The engagement's third-party auditor records `unqualified`, `qualified` or `adverse`, with a note (20+ characters for qualified or adverse). *Unqualified* needs every applicable control effective and no unresolved serious finding. If an auditor is assigned, the engagement cannot close without an active sign-off. If none is assigned, iSecurify staff with manage rights record a waiver with a reason (refused while an auditor is assigned). A sign-off can be withdrawn with a reason, and an unqualified one that has gone stale (readiness changed since) no longer lets the engagement close. The audit actions are `engagement.signed_off`, `.signoff_waived` and `.signoff_withdrawn`.

**Renewal.** `POST .../renew` on a *closed* engagement (client admin or staff manager) creates the next engagement with `renewed_from` set. It uses the latest published version of each framework (or the same ones), and carries accountable owners, not-applicable decisions with reasons, the iSecurify team and auditor (only people who still have access) and unresolved findings (marked `carried_from`, skipped when their control is no longer applicable). Evidence and sign-offs are never copied. An engagement can be renewed once (409 `already_renewed`). Audited as `engagement.renewed` and `engagement.renewal_started`.
