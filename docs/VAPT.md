# VAPT rounds (Phase 11D)

An engagement runs for a year and usually has two or three penetration-test rounds. A round is a planned piece of work inside the engagement, with its own report, findings and retest.

## Who can do what
- **See rounds:** iSecurify staff on the organization, client administrators, and the engagement's third-party auditor. Client staff and vendors do not see the tab.
- **Plan, edit, move through the status flow, tag findings:** iSecurify managers and the engagement's third-party auditor. Client administrators have read-only access.
- Closed engagements are read-only. At most 8 live rounds per engagement.

## Status flow
`Planned → Testing in progress → Report issued → Retest in progress → Closed`, with `Cancelled` from planned or in progress. Steps cannot be skipped, except that a report can be closed without a retest.
- *Report issued* needs a report title (and records the date). The report file itself is attached as ordinary evidence on a checklist item; the round records the title and reference.
- *Closed* is refused while a critical or high finding tagged to the round is still open (close it, or accept the risk). The database also refuses a closed round with no `closed_at`, or a reported round with no title.
- Closed and cancelled rounds cannot be edited and take no new findings.

## Findings
A finding carries an optional `round_id`. Tag it when raising (`roundId` in the body), when importing a scan (`roundId` with the import; the import dialog has a round picker), or afterwards with `PUT /t/:tid/vapt-rounds/:rid/findings {findingIds, untag?}`. The round must belong to the same engagement and be live.

## Comparison
`GET /t/:tid/engagements/:id/vapt` returns, per round: new findings (and how many critical/high), findings carried in (earlier rounds' findings still open when this round started), findings closed while this round ran until the next began, and findings of this round still open. These are computed from dates, so closing a finding later does not rewrite an earlier round's figures. The trend compares the critical/high count of the last two reported rounds.

## Reminders
The worker's daily run notifies the engagement's team and auditor and the client administrators a week before a planned round, on its day, and when it is three days late (kind `vapt.round_due`, switchable in notification preferences). One notice per person, round and stage (`vapt_notice_log`).

## Audit
`vapt.round_created`, `vapt.round_updated`, `vapt.round_status`, `vapt.findings_tagged`, `vapt.findings_untagged`.
