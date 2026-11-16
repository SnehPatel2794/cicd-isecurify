# Incident register (Phase 9C)

## Reporting
Anyone who belongs to the organization (client admin, client staff, vendor, auditor) and managing iSecurify staff can report an incident (INC-001 ...): a title, details, type, how serious it looks, when it happened (optional) and when it was noticed (default now; never in the future; not before it happened). High and critical reports notify the client admins.

## Who sees what
Client admins, auditors and managing staff see every incident. Everyone else sees only incidents they reported or own; any other incident is "not found". Other organizations never see anything.

## Triage
Client admins and managing staff set the severity, the owner (a client admin, staff member or vendor), whether the authorities must be told (*reportable*) and when they were told. The reporter may reword their own report until the incident is picked up.

## Status
| From | To | Needs |
|---|---|---|
| Reported | Investigating | an owner; the owner or a triager |
| Reported | Closed (dismissed) | a reason; client admin or managing staff |
| Investigating | Contained | owner or triager |
| Contained | Resolved | a **root cause** |
| Contained or Resolved | Investigating | a note (reopening) |
| Resolved | Closed | **lessons learned** and **corrective actions**; if reportable, the time the authorities were notified; by a client admin or managing staff member who is **not the owner** |
| Closed | Investigating | a note |

Reopening clears the contained, resolved and closed times, so the timeline stays honest. A closed incident is frozen (no edits, comments or link changes) until reopened.

## Links and records
Client admins and managing staff can link an incident to risks of the same organization. Incidents are never deleted and keep their number and reporter; events are append-only; the database enforces owner-before-investigation, root-cause-before-resolved, closed-time consistency and detection-after-occurrence. Audit: `incident.reported/updated/status/linked/unlinked`. Owners of open incidents block account deletion until reassigned.

The register summary shows open incidents by severity, incidents awaiting authority notification and the average hours from detection to resolution. Critical incidents and pending authority notifications appear in the portfolio attention list.
