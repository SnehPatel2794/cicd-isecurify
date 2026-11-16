# Tasks (Phase 13B)

Every engagement has a **Tasks** tab: who does what, by when, and what it waits for. It is for the work around the controls (kick-off, workshops, policy writing, audit bookings). Controls, evidence and findings keep their own screens.

## Who can do what

| Person | Sees | Can do |
|---|---|---|
| iSecurify staff with "manage" on the organization | All tasks | Create, edit, assign, cancel and reopen; import a plan or apply a template; export CSV |
| iSecurify staff without "manage" | All tasks | Read, comment, change the status of tasks assigned to them |
| Client administrator | All tasks | Create, edit, assign, cancel; comment; export CSV. Cannot import plans |
| Client staff, vendor | Only tasks assigned to them | Change the **status** of their task and comment. Nothing else. Other people's tasks do not exist for them (404) |
| Third-party auditor | All tasks | Read only |
| Platform administrator | Task templates | Upload, list and archive templates (Frameworks page, "Task plan templates") |

A closed engagement is read-only. Tasks are never deleted: cancel them (managers only), which keeps the history.

## Fields

Title, description, assignee, priority (low / normal / high), start and due date, status (not started, in progress, waiting on client, blocked, done, cancelled), engagement phase (1 to 5), stage (free text) and "Responsible" (the role written in a plan, shown while no person is assigned). Each task gets a number per engagement (T-001). Setting a task to done stamps the completion time; moving it back clears it.

**Dependencies:** a task can depend on other tasks of the same engagement. Loops are refused (409). A task shows "waiting on N" while the tasks it depends on are open. Dependencies inform; they do not block changing a status.

**Comments:** the assignee and managers write them; they are kept and cannot be edited. Files are **not** attached to tasks: upload documents as evidence and mention them in a comment.

## Reminders and notices

- The assignee gets an in-app notice (and an email unless they switched it off under Notifications, kind "Tasks") when a task is assigned or reassigned to them, and the task creator when the assignee comments. While a person still has an unread notice for the engagement, a further notice does not pile on top of it.
- The reminder worker tells the assignee once when a task is due within 2 days and once when it is overdue (kind `task.due`, same preferences).
- **My work** lists the open tasks assigned to you with the overdue ones first.
- The engagement page shows "Open tasks" (red when any is overdue). The phase check **warns** (does not block) about overdue tasks.

## Plans: import a spreadsheet or apply a template

Download the template from Import plan or template, or from Task plan templates. Columns (header names are matched loosely; text in brackets is ignored):

| Column | Meaning |
|---|---|
| Ref | Short key used by dependencies, e.g. `1.4`. Needed when something depends on the row |
| Stage, Phase | Free text; phase as a number 1 to 5 or its name |
| Task | Required |
| What it is, How it is done | Joined into the description |
| Responsible | Role as written; not a login. Assign people after loading |
| Days | Working days the task takes. `0` makes a milestone |
| Depends on, Also depends on | Refs of earlier or later rows |
| Priority | low, normal, high |

You choose a **start date**; the platform works out each task's dates from it, the days each task takes and its dependencies, skipping Saturdays and Sundays (public holidays are not known). The upload shows a preview first; one error blocks the whole plan, so nothing is half-loaded. Formulas in cells are refused.

A platform administrator can save a plan as a **template** (optionally for one framework). iSecurify staff with "manage" then apply it to an engagement with a start date. Applying the same template twice creates the tasks twice.

`docs/tasks/techify-iso27001-soc2-vapt-plan.xlsx` is the Techify delivery plan (deployment to certificate, 62 rows) in this format. Start it on a date and it ends about ten months later, mostly the SOC 2 observation window.

## Limits

Up to 3000 tasks per engagement, 500 rows per import file (5 MB). Not built: time tracking, drag-and-drop Gantt, custom workflows, file attachments on tasks.

## Audit

Audit log actions: task.created, task.updated, task.status_changed, task.commented, task.imported, task.template_applied, task_template.created, task_template.archived. They appear in the engagement Activity tab.
