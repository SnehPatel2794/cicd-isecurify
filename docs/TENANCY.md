# Tenancy model (Phase 2)

**Tenant = client organization** (`organizations`). iSecurify itself is not a tenant: its people are *platform users* (`users.platform_role`).

## How access is decided — one function
`modules/tenancy/data.ts → resolveAccess(userId, tenantId)`
1. Membership in the tenant (`memberships`: client_admin | client_staff | third_party_vendor | tp_auditor) → that role.
2. Else an **active** staff assignment (`staff_assignments`, with `can_manage`, `can_read_evidence`, optional `expires_at`) → iSecurify staff access.
3. Else `null` → every `/t/:tenantId/*` route answers **404** (never 403), so a tenant or record's existence is not revealed.
Platform roles (super_admin, admin) have **no implicit access**. They manage organizations, users, frameworks and assignments. Note: an admin-level user *can* assign themselves to a tenant; that action is audited (`staff.assigned`, detail `self:true`).
The tenant always comes from the URL path and is checked against the authenticated session. Client-supplied `tenantId` fields in bodies are ignored (tested).

## Rules enforced in code
- All SQL on tenant-owned tables lives in `modules/tenancy/data.ts`, `modules/engagements/data.ts`, `modules/audit/data.ts`, `platform/audit.ts`. `test/05_data_layer.test.ts` scans every other source file and fails the build if one touches `memberships`, `staff_assignments`, `invitations` or `audit_events`. (Mutation-checked: planting a raw query makes it fail.)
- **Composite FK pattern** for every tenant-owned child table from Phase 4 on: `PRIMARY KEY (tenant_id, id)` and `FOREIGN KEY (tenant_id, parent_id) REFERENCES parent(tenant_id, id) ON DELETE RESTRICT`. The test shows MySQL rejecting a child that points at another tenant's parent. It is now used by every Phase 4 table (engagement → checklist item → control link, SOA, phases, members, milestones, discovery) and is tested with raw SQL.
- Pure policy rules (`modules/tenancy/policy.ts`) are tested exhaustively: client_admin may only handle client_staff and vendors; auditors are appointed by iSecurify only; only a Super Admin grants admin roles; nobody edits themselves.
- Suspended/archived organizations are closed to everyone (403 `org_inactive`); archive/restore needs a Super Admin.
- An organization always keeps at least one client admin; the system always keeps at least one active Super Admin.

## Extension points used by later phases (no edits to this module needed)
- `modules/users/hooks.ts → deletionBlockers`: Phase 4 registers "open checklist items" so people with open work cannot be removed or deleted until reassigned.
- `modules/users/hooks.ts → manifestProviders`: Phases 5/6 add their uploads, comments and findings to the account-backup PDF.

## User deletion
Soft delete only: row kept (history keeps its foreign keys); email anonymized (`deleted-xxxxxxxx@removed.invalid`, so the real address can be invited again); name "Deleted User"; password, sessions, MFA and recovery codes removed; staff assignments removed. Requires a downloaded backup PDF (recorded in the audit log) **or** typing the user's exact email to proceed without one. `user_deletion_log` is append-only and keeps the email/name snapshot (retention: review under your data-protection policy).
Client admins can *remove a membership*; deleting the account itself is an iSecurify admin-level action.
