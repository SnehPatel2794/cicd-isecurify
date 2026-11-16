# Storage, archival and legal hold (Phase 10D)

## Where files live
`EVIDENCE_DIR/evidence/<organization id>/<version id>` (random ids; the original file name is kept only in the database). Files are immutable: never overwritten, checked against their SHA-256 on download and by the verify and restore scripts.

## Limits
| Setting | Default | Meaning |
|---|---|---|
| `EVIDENCE_DEFAULT_QUOTA_MB` | 0 | Platform default per organization. 0 = **no limit**. |
| per-organization limit | none | Set by an administrator on *Administration → Storage* (Limit). Only stops new uploads; nothing is removed. |
| `EVIDENCE_MAX_FILE_MB` | 25 | Largest single file (1 to 100). |
| `EVIDENCE_MIN_FREE_MB` | 1024 | **Disk guard.** Uploads pause with a clear message when the evidence disk has less than this free (plus room for one file). Links still work. 0 turns it off. |

## Retention and archival
- Each organization has a retention period (default 7 years, set when the organization is created).
- Once a closed engagement has been closed for longer than that period, the worker marks its evidence **archived** (daily job, at most 200 per run). Archived evidence is **kept in full and stays read-only**; it is flagged in the engagement list and can be hidden or shown. **Nothing is ever deleted.**
- Archival is audited (`evidence.archived`, actor: retention schedule).
- An administrator can **restore** an archived engagement (*Storage → Archived engagements*). A restored engagement is not archived again automatically.

## Legal hold
- An administrator can place a hold on a whole organization or on one engagement, with a reason (audited: `legal_hold.placed` and `legal_hold.released`).
- While a hold is in place the worker does not archive. Releasing the hold lets the schedule continue.

## Quarantine
Files the malware scan flagged are listed per organization (*Quarantine*, for client administrators and iSecurify staff) and across all organizations on the Storage page. They cannot be downloaded or accepted.

## Admin page
*Administration → Storage*: disk space, usage per organization, limits, retention, archived and flagged counts, legal holds, restore, quarantine.
