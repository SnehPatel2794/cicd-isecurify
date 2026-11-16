# iSecurify GRC: user guide for clients

This is for people at a client organization: **client admins**, **client staff** and **vendors**. Auditors have a short section at the end. The in-app **Help** page has the same topics with search.

## 1. Signing in
1. Open the invitation email and choose a password (12+ characters).
2. Set up two-step verification if asked (an authenticator app). Keep the recovery codes somewhere safe.
3. Forgot your password? Use *Forgot password* on the sign-in page. Lost your phone? Ask your client admin or iSecurify contact to reset two-step verification.

## 2. What you see
| Role | Sees |
|---|---|
| **Client admin** | Everything in your organization: engagements, checklists, evidence, findings, risks, policies, incidents, vendors, people, API keys and webhooks. |
| **Client staff** | Your organization's data, except people management. Can work on items assigned to you. |
| **Vendor** | Only the items assigned to you. Everything else is invisible. |
Start from **My work**: it lists what is waiting for you, oldest first.

## 3. Audit work (engagement)
The engagement moves through five phases. Each has a list of what must be done before moving on.
- **Tasks:** your tasks appear here and in My work. Change the status as you go (in progress, waiting on client, blocked, done) and add a comment. Client administrators also see and assign all the tasks. Details: `docs/TASKS.md`.
- **Questionnaire:** answer each question, save, and submit for review. If iSecurify sends a question back, a note says why. Questions are standard per framework and a snapshot is kept for your engagement.
- **Checklist:** every control has an owner (*accountable person*) and a readiness: not started, in progress, implemented, not applicable (with a reason). A control counts as effective only when its required evidence has been accepted.
- **Evidence:** open the request, read the instructions, upload the file (PDF, image, office document; up to the size limit shown). The auditor accepts it or rejects it with a note; if rejected, upload a new version. Old versions are kept. Evidence has a valid-until date; you are reminded before it expires.
- **Findings and VAPT:** findings from the audit or penetration test appear with severity, owner and due date. Mark them fixed with a note; iSecurify verifies. Retests are tracked per round.
- **Sign-off:** at the end the auditor records an opinion. You see it on the engagement and on the certificate.
- **Next year:** iSecurify can renew the engagement; your owners and decisions carry over.

## 4. Other registers
- **Risks:** add, rate (likelihood and impact), choose treatment, link controls. Accepted risks need a reason and a review date.
- **Policies:** read and acknowledge each version; admins publish new versions.
- **Incidents:** log what happened, when, impact, and actions. Keep it factual.
- **Vendors:** your suppliers and their assessment status.
- Lists can be filtered, saved as views and exported as CSV.

## 5. Good habits
- Upload final, readable files. Redact what the auditor does not need.
- Use the note field; a one-line explanation saves a round of back and forth.
- Keep owners current: when someone leaves, ask your client admin to reassign their items first.
- Never share your password or recovery codes. iSecurify staff will never ask for them.

## 6. Privacy and security in short
Your data is separated from every other client's. iSecurify staff see your evidence only if specifically permitted. Every action is logged and the log cannot be altered. Files are checked for tampering. Ask your iSecurify contact for the security summary.

## 7. For auditors (third party)
You see only the engagement you were appointed to. Review each submitted evidence version: accept, or reject with a note. In phase 5 record the opinion; *qualified* and *adverse* need a written reason of at least 20 characters, and *unqualified* is only possible when every applicable control is effective and no serious finding is open.

## 8. Help
In-app **Help** (search box). Otherwise your iSecurify contact. For a suspected security problem, tell them immediately.
