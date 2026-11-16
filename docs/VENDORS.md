# Vendor risk (Phase 10A)

A register of the third parties an organization depends on, with a scored security assessment for each and a review date by risk tier. Migration `020_vendors.sql`; code in `api/src/modules/vendors/`; screen `web/src/pages17.tsx`.

## Vendors
Each vendor has a name (unique per organization), what it does, a category, **criticality** (low to critical), the **data it can reach** (none, internal, confidential, personal, regulated), an owner (client admin or staff), an optional vendor contact (a `third_party_vendor` member who answers assessments), contract dates and a status: onboarding, active, offboarding, offboarded. Vendors are never deleted; the history is append-only.

**Risk tier** = criticality (1-4) x data access (1-5): up to 3 low, up to 8 medium, up to 14 high, above that critical. The tier sets the reassessment interval: critical 6 months, high 12, medium 24, low 36.

## Who can do what
- Add, edit, change status, request an assessment: client admins and managing iSecurify staff.
- Review an assessment: those, plus auditors. Never the person who submitted it.
- See the register and export it: managers and auditors. A vendor user sees only the vendor they are the contact for (without internal history). Client staff have no access. Other organizations get 404.

## Status
onboarding -> active | offboarded; active -> offboarding; offboarding -> active | offboarded. **Activating** needs an owner, a contract that has not ended, and, for high and critical vendors, an approved assessment. Offboarding needs a reason. An offboarded vendor is frozen.

## Assessments
One open assessment per vendor. The questionnaire (version 1) has 24 questions in 10 domains, each weighted 1 to 3. Answers are yes, partly (counts half), no, or not applicable (needs an explanation, and drops out of the score). The score is the weighted share met, 0 to 100; 80+ good, 60-79 fair, below 60 poor.
1. A manager requests it (optional due date); the vendor contact is notified.
2. The contact, or a manager on their behalf, saves answers and submits once every question is answered. The owner is notified.
3. A different person approves, rejects (final) or sends it back to draft; rejecting or sending back needs a note. Approval sets the vendor's next review date by tier. Decided assessments are permanent.

Gaps are listed most serious first: a "no" on a weight-3 question, other "no" answers, then partial answers on weight-3 questions.

## Elsewhere
Vendor counts appear in organization analytics. Exports: `GET /t/:id/vendors/export?format=csv|xlsx` (formula-safe, capped at 2,000 rows, audited). A user who owns or is the contact for a live vendor cannot be deleted until reassigned.
