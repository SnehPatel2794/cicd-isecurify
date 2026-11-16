# iSecurify GRC: administrator guide

For iSecurify staff who run the platform (Super Admins and Admins) and for the person who looks after the server. Technical detail lives in `docs/RUNBOOK.md`, `docs/DEPLOY.md` and `docs/RELEASE.md`; this guide tells you what to do and in what order.

## 1. Who is who
| Role | What they can do |
|---|---|
| **Super Admin** | Everything an Admin can, plus: create and remove Admins, switch policies (for example mapping approvals), grant staff the right to read client evidence, branding and email settings. |
| **Admin** | Frameworks, common controls, templates, process templates, organizations, users, audit log, system status. No client data unless assigned to the organization. |
| **iSecurify staff on a client** | Assigned per organization with two switches: *can manage* and *can read evidence*. Platform roles alone give **no** access to a client's data. |
| **Client admin / client staff / vendor** | Belong to one client organization (see the client guide). |
| **Third-party auditor** | Appointed by iSecurify to one engagement. Reviews evidence, records the sign-off opinion. |

Two-step verification is required for every platform user. Lost phone: another Super Admin resets it; if nobody can, the server owner runs `docs/RUNBOOK.md` > *Recover admin*.

## 2. First day on a new server
1. Sign in with the first Super Admin link from the installer. Set a password and two-step verification at once (Account security).
2. **Branding** (name, logo, colours) and **Email delivery** (send a test mail to yourself; fix SMTP in `.env` if it fails).
3. **System status**: every line should be green: database, queue, backups, restore drill, storage, off-server copy (when switched on).
4. **Frameworks**: import each framework you audit (spreadsheet import, `docs/FRAMEWORKS.md`), review it, publish the release. Add the questionnaire for the framework if you use one (`docs/QUESTIONNAIRES.md`; ready-made DPDP and ISO 27001 files are in `docs/questionnaires/`). Mark the compulsory questions as Core and tag sector questions with industries.
5. **Process & discovery**: check the milestone template and discovery questions.
6. Create the first **Organization**, invite its **client admin**, then assign your own staff to it.

## 3. Starting a client
1. Organizations > New. Add the client admin by email; they receive an invitation.
2. Assign iSecurify staff (manage / read evidence as needed) and, on the engagement, the third-party auditor.
3. Create the **engagement**: choose the framework release(s), audit path (Type I, Type II, or I then II) and dates. The checklist, milestones, discovery questions and questionnaire are created from the templates.
4. Work through the five phases. The system lists what is outstanding before each advance; warnings can be acknowledged, blocks cannot.
5. At the end: auditor sign-off (Unqualified / Qualified / Adverse), certificate, close. Next year: **Renew** on the closed engagement; owners, not-applicable decisions and open findings carry over.
6. VAPT rounds (twice or thrice a year) are tracked on the engagement's VAPT tab; reminders go out automatically.

## 4. Everyday duties
| When | What |
|---|---|
| Daily | Glance at **System status** and **My work**. The platform emails administrators when backups are late, the off-server copy fails, storage is low or mail delivery fails (once a day per problem). |
| Weekly | Check that the automatic **restore drill** shows *ok*. A backup is only trusted once a drill has passed. |
| Monthly | Review Users (remove leavers; see section 5), review Audit log filters for unusual admin actions, check Storage use per client. |
| Quarterly | Run the go-live checklist sections 4 and 5 again (`docs/GO_LIVE.md`); rehearse a real restore on staging. |
| Each release | Follow `docs/RELEASE.md`: staging first, dry run, apply, smoke test. |

## 5. People and access
- **Add:** Users > Invite. **Remove:** deactivate (the person's history stays; their sessions end at once). Do this the day someone leaves, for iSecurify staff and for client contacts the client asks you to remove.
- A client admin manages only their own staff and vendors. Auditors are appointed only by iSecurify.
- API keys and webhooks are per client; a client admin creates them, you can revoke from the organization.
- The **Audit log** records who did what, when, from where. It cannot be edited or deleted (enforced in the database).

## 6. Data you hold for clients
- Evidence files are stored on the server's evidence volume with a SHA-256 on record. No storage limit by default; each file is capped (`EVIDENCE_MAX_FILE_MB`, 25).
- Downloads need *can read evidence*. Staff without it can manage but not open files.
- Ending a client: close the engagements and archive the organization's evidence in **Storage** (legal holds can block removal). There is no one-click erase of an entire organization: a full erasure request is a deliberate operation on the server (take a backup first, agree the retention period in the contract, and record who approved it). Individual users can be deleted; their history stays, anonymized (`docs/TENANCY.md`).

## 7. When something looks wrong
| Symptom | First step |
|---|---|
| Red line on System status | Click it: each line says what failed and what to do. |
| Users say they get no emails | Email delivery > *Send test*; check the sent-mail log for errors; see `docs/EMAIL.md`. |
| Backup late or failed | `deploy/backup.sh` on the server; log in `/var/log/isecurify-backup.log`. |
| Nobody can sign in | `docs/RUNBOOK.md` > *Recover admin*. |
| Bad release | `deploy/apply-patch.sh --rollback` (code). Migrations are not undone: restore the pre-patch backup if a migration must be reverted. |
| Suspected incident | Follow `docs/SECURITY.md` and tell the affected clients within the period in your contract. |

## 8. What this platform does not do
No built-in AI or copilot features, no single sign-on, no billing. These are deliberate and out of scope.
