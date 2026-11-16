# Dashboards (Phase 13C)

| Screen | Who | What it shows |
|---|---|---|
| **Portfolio overview** (`/analytics`) | Super Admin and administrators: **every** organization. iSecurify staff: the organizations assigned to them | One row per organization: active engagements, readiness, unresolved and overdue findings and checklist items, open and overdue tasks, certificates, what needs attention. Filter by name, demo or real. A "Demo" badge marks demo organizations |
| **Organization analytics** (`/org/:id/analytics`) | Client administrators, assigned staff, auditors | Readiness by framework, findings by severity and age, trends, evidence, risks, incidents, vendors, policies, certificates, and **Tasks across engagements** (open, overdue, due this week, unassigned, workload per person, progress per phase, overdue and upcoming lists). The engagements table gains open and overdue tasks |
| **Engagement dashboard** (first tab of an engagement) | Administrators, staff, auditors (not client staff or vendors, who see their own work) | Phase tracker, readiness, overdue checklist items, evidence awaiting review, unresolved findings, open and overdue tasks, tasks by status, workload, progress per phase, findings by severity, evidence, certificates, overdue and upcoming tasks |

**Click-through.** Every figure leads to the list behind it: tiles open the Checklist, Evidence, Findings or Tasks tab (overdue tasks open the Tasks tab already filtered to overdue; a status bar opens it filtered to that status); a task in a list opens its detail.

**Administrators and privacy.** The Super Admin and administrators see all organizations in the portfolio as counts only (no evidence, findings text or documents). Opening an organization's engagements still needs assignment to it, so unassigned organizations show without a link. An overdue task adds "N tasks overdue" to an organization's "Needs attention" list.

The numbers use the same calculation as the checklist, reports and phase check, so they agree everywhere. They refresh when the screen is opened; there is no live push. Charts are plain bars with numbers beside them, readable without colour.
