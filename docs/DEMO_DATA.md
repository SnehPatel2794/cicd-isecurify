# Demo organizations and wiping mock data (Phase 13C)

Real client data is never deleted from iSecurify: evidence, findings, tasks and the audit log are kept on purpose. Mock data needs a way out, so there is one narrow, deliberate route.

## How it works

1. **Mark at creation.** Tick "Demo / test data" when the Super Admin or an administrator creates an organization (Client organizations page). The mark is stored in the database and **can never be changed afterwards**, in either direction. An organization created without it can never be wiped. If you forgot to tick it, create a new demo organization.
2. **Wipe.** Only the **Super Admin** sees "Wipe demo data" on a demo organization. The dialog needs the exact organization name and the Super Admin's password. Optionally it also deletes people who belong **only** to that organization (never platform users, never anyone who is also in another organization).
3. **What is removed:** every row of the organization in every table (engagements, checklists, evidence records, findings, tasks, reports, risks, policies, incidents, vendors, certificates, questionnaires, notifications, the organization's own audit entries), the evidence files on the server, and the organization itself. All database changes happen in one transaction: if anything fails, nothing is deleted.
4. **What stays:** one platform-level audit entry `org.wiped` (who, when, the name and counts of what was removed; not the content). Global material (frameworks, templates, branding), platform users, and every real organization.

## Why a real client cannot be wiped by mistake (or by an attacker)

The delete protections are database triggers (migration 033). A delete is allowed only for rows of an organization that is marked demo **and** whose wipe has started inside the same transaction. Marking cannot be changed, so even someone who gains full control of the application cannot make a real organization wipeable. The web application's database account still cannot delete anything.

## Switching it on (one extra setting)

The wipe uses a separate database account, `grc_purge`, that can only read and delete tenant rows. It is created only when you set a password:

1. In `.env` set `PURGE_DB_PASSWORD=` to a new random value (`openssl rand -base64 32`).
2. `docker compose up -d` (the database setup step creates or updates the account and the API picks the password up).

Without the setting everything works as before and the wipe dialog says it is not set up. To switch it off again, empty the value and run `docker compose up -d`, then drop the account in MySQL if you want (`DROP USER 'grc_purge'@'%';`).

## Notes and limits

- Take a backup before wiping if there is any doubt. A wipe cannot be undone.
- If a file cannot be removed from storage the dialog says how many; the hourly maintenance job also removes files that no record refers to once they are 24 hours old.
- Global sample material such as a demo framework is not part of an organization. A released framework is kept for history; archive it instead.
- Background jobs already queued for a wiped organization are not removed; they may log an error once and are then dropped.
