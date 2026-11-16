# Admin screens (Phase 9A)

## Process & discovery (`/process`, sidebar for platform users)
- **Milestone templates:** the generic template and one optional template per framework. Milestones are grouped under the five phases; each can be limited to audit paths (Type I only, Type II only, Type I then Type II). Saving replaces the template's milestone list. Existing engagements keep their own copy. A framework without its own template uses the generic one.
- **Discovery questions:** per framework or for all engagements. Questions are never deleted (answers refer to them); retire or restore them.
- Administrators (Admin, Super Admin) edit; other platform users read. Every save is audited (`process_template.saved`, `discovery_question.created/updated`).

## Mapping approvals (`/mapping-approvals`, administrators)
- **Policy** `mapping_approval` (default off). Only a Super Admin switches it (audited `settings.mapping_approval`).
- **When on:** changing or removing the mapping of a control in a **published** release returns 409 `approval_required`. The screen then offers to submit a request with a reason. Drafts stay direct.
- **Decision:** a *different* administrator approves or rejects (rejection needs a note). Nobody decides their own request (API and database). The requester can withdraw. One pending request per control. Approving applies the change through the same code as a direct edit: the history records the approver, the audit entry records the requester (`requestedBy`).
- **Records:** `mapping_change_requests` is never deleted, decided once, and its content cannot change (triggers). Audit: `mapping.requested`, `mapping.request_approved/rejected/withdrawn`.
