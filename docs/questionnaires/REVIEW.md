# Review of the DPDP and ISO 27001 scoping questionnaires

## Verdict
Both are sensible first drafts of a **pre-sales sizing form** (they ask the right broad questions about size, scope and timeline). As **engagement questionnaires** they need more depth, structure and a consistent upload format.

## What is good
- Clear purpose statement and instructions; a named coordinator; a declaration (ISO form).
- The DPDP form is organised in logical sections and says "sizing only, not an assessment", which keeps clients relaxed.
- The ISO form asks for attachments and for a certification body and target date.

## What is missing or weak
| Area | Issue | Effect |
|---|---|---|
| Format | Almost every answer is free text ("approximate figures acceptable"). | Answers cannot be scored, compared or reported on. |
| Format | The DPDP file has one tab per section and the ISO file is a Word document. | Neither can be uploaded; each client answer would have to be retyped. |
| Format | Compound questions ("servers and endpoints", "vendors and cross-border"). | Two numbers in one cell; ambiguous. |
| DPDP | Does not ask for the client's **role** (Data Fiduciary, Joint, Data Processor). | The duties and effort differ a lot. |
| DPDP | No **Significant Data Fiduciary** indicators (volume, sensitivity, risk). | Misses the heaviest obligations (DPO in India, audits, impact assessments). |
| DPDP | Nothing on **rights handling**, **breach process**, **retention and erasure**, **withdrawal of consent**, **log retention**. | These are core DPDP workstreams and drive effort. |
| DPDP | Children: only a volume question. | No question on parental consent mechanism or tracking and ad targeting. |
| ISO | No **scope exclusions**, interfaces or dependencies. | Weak scope statement; audit surprises later. |
| ISO | Headcount asked, but not **inside scope** or contractors in scope. | Audit duration is based on people in scope. |
| ISO | No **cloud provider**, shift work or repeated-site questions. | Under-estimates sampling and technical effort. |
| ISO | No maturity questions: risk assessment, asset register, internal audit, BCP tests, Statement of Applicability. | Cannot size "build vs refine". |
| ISO | Offers "migration from 27001:2013". | Certificates to the 2013 edition ceased to be valid after the transition period ended on 31 October 2025; confirm with the certification body. Replaced by clear options. |
| Both | No sector-specific questions. | A bank, a hospital and a SaaS company get the same form. |
| Both | No separation of "compulsory for everyone" from "optional". | Every client gets the same long form or each consultant edits their own copy. |

## What replaces them
Two upload-ready spreadsheets, one per framework, in the single iSecurify template (Ref, Section, Question, Answer type, Choices, Required, Help text, **Core (all clients)**, **Industries**):
- **DPDP:** 86 questions in 14 sections (40 core, 11 sector-tagged).
- **ISO/IEC 27001:2022:** 63 questions in 10 sections (30 core, 10 sector-tagged).
Answers are mostly pick-lists, numbers and dates so they can be compared across clients.

## How the three needs are met in the app
1. **Specific template to upload:** one template (xlsx or csv) from the framework page; preview shows every error; saved whole or not at all.
2. **Add, delete or modify per company or industry:** staff set the client's industry; sector questions appear; staff can add questions from the standard list or write their own, edit wording, or remove (with a reason, restorable).
3. **Common and compulsory stay intact:** questions marked Core cannot be edited or removed on any engagement, enforced in the API and the database. Platform admins change core questions only by publishing a new questionnaire version, which affects new engagements, not running ones.

## Before you rely on them
- Have your DPDP and ISO consultants read the wording and the Core flags; they are a proposal, not legal advice.
- DPDP Rules and timelines have been moving: check the retention, breach and Significant Data Fiduciary questions against the current Rules.
- Keep Core small. Every core question is compulsory for every client.
