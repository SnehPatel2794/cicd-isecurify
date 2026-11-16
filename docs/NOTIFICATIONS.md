# In-app notifications (Phase 7B)

A bell in the header shows how many notifications you have not read. Click it for the latest ten, or open **See all and settings** (`/notifications`) for the full list, filters and switches. The count refreshes every minute and when you return to the tab.

## What creates a notification
| Kind | Who is told | When |
|---|---|---|
| `item.assigned` | the new accountable person | a checklist item is assigned to them |
| `evidence.requested` | the item's accountable person | evidence is requested on their item (single requests; bulk requests do not notify, to avoid a flood) |
| `evidence.submitted` | whoever made the request | a file or link is submitted |
| `evidence.accepted` / `evidence.rejected` | the person who submitted it | the auditor reviews it |
| `finding.assigned` | the new owner | a finding is raised with, or changed to, that owner |
| `finding.ready_for_retest` | whoever raised the finding | the owner marks it ready |
| `finding.closed` | the owner | closed, risk-accepted or cancelled |
| `finding.reopened` | the owner | sent back to remediation or reopened |
| `finding.comment` | the owner and the person who raised it | a comment is added |

## Rules
- You are never notified about your own action, and never twice for the same event.
- **One unread line per thing.** If you already have an unread notification of the same kind about the same finding or request, a new one is not added until you read it (ten comments in a row are one line, not ten).
- Created in the **same transaction** as the action, so a notification exists exactly when the thing happened. A notification failure never undoes the action (it is logged and skipped).
- Only people who can still enter the organization are notified, and the list only shows organizations you can enter **now**. If your access is removed, those notifications disappear from view; if it is restored, they are back.
- A notification stores a short label (for example `F-003 Weak password policy`) and ids. Opening it uses the normal screens, so losing access to the item gives "not found", never a leak.
- Everyone can switch any kind off under **What shows up in the app**. Missing setting = on.
- Retention: read notifications are deleted after 90 days and anything after 180 days (worker cleanup). Deleting an account removes its notifications and settings.
- The database allows only `read_at` to change on a notification.

## API
`GET /me/notifications/count`, `GET /me/notifications?unread&tenantId&before&limit`, `POST /me/notifications/read {ids}|{all:true}`, `GET|PUT /me/notification-prefs`.

Reminder kinds (`reminder.due_soon`, `reminder.overdue`) are created by the worker's daily scan; see `docs/REMINDERS.md`.

## Not covered yet
Per-event email copies (the digest in `docs/REMINDERS.md` covers email). Notifications for archived organizations are hidden.
