# Policies (Phase 9C)

## Versions
A policy (POL-001 ...) belongs to one organization and has a title, category, owner (a client admin), audience and review period (1-36 months). Its text lives in numbered **versions**:

| Status | Meaning |
|---|---|
| Draft | being written; the only status that can be edited or discarded |
| In review | submitted; waiting for another manager |
| Published | the live version (at most one per policy) |
| Superseded | a former live version, kept for ever |

Only one draft or in-review version can exist per policy. A new draft starts as a copy of the live text.

## Who can do what
| Action | Who |
|---|---|
| Create, edit drafts, submit, withdraw, discard, archive, change audience or owner | client admins, managing iSecurify staff |
| Approve and publish, or send back with a note | a client admin or managing staff member **who did not write that version** |
| See drafts, history and who acknowledged | client admins, managing staff, auditors (auditors can comment) |
| Read the live policy and acknowledge it | people in its audience: *Client admins and staff*, or *Everyone* (adds vendors) |

Staff and vendors never see drafts, archived policies or policies not meant for them (not found). iSecurify staff and auditors do not acknowledge.

## Acknowledgement
Publishing notifies everyone the audience requires. Each person acknowledges the live version once; acknowledging an older version is refused ("a newer version has been published"). Publishing a new version resets the count. A manager sees who has and has not acknowledged. People who leave the organization stop counting.

## Review
Publishing sets the next review date to today plus the review period (month ends are clamped, 31 January + 1 month = 28 February). Overdue reviews show in the list, analytics and the portfolio attention list. Review is done by drafting and publishing a new version (even if the text is unchanged).

## Records
Published and superseded versions cannot be edited, deleted or un-approved, and the approver can never be the author (database checks and triggers). Acknowledgements and policy events are append-only; policies are never deleted, only archived. Audit: `policy.created/updated/archived/restored/version_drafted/version_edited/version_discarded/submitted/rejected/withdrawn/published/acknowledged`. Owners of active policies block account deletion until reassigned; the backup manifest lists versions written and policies acknowledged.

Not built yet: reminder emails for pending acknowledgements or overdue reviews (they show on screens and in analytics), and file attachments (policy text is plain text up to 50,000 characters).
