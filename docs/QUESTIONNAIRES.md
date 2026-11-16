# Engagement questionnaires (Phase 11E)

The standard checklist questions asked of a client at the start of an engagement, one set per framework.

## Platform side (administrators)
1. Download the template (`.xlsx` or `.csv`) from the framework page. Columns: **Ref #, Section, Question, Answer type, Choices, Required, Help text**. Header names are matched loosely (for example "Mandatory" for Required).
2. Answer types: `yes/no`, `choice` (two or more choices separated by `|`), `text`, `number`, `date`. Required defaults to yes.
3. Upload. The preview shows every row with its errors and writes nothing. A questionnaire is saved **whole or not at all**: any row with an error blocks saving. Rows starting with `= + - @` are refused (spreadsheet formula injection). Limits: 5 MB, 1000 questions.
4. Saving creates a **draft** (a re-upload replaces the draft). **Publish** makes it the live version and retires the previous one. Published versions are kept as a record and never edited.

## Engagement side
- When an engagement starts, or a framework is added (including on renewal), the framework's published questionnaire is **copied** into the engagement. The copy is frozen: publishing a newer version never changes an engagement that already has one.
- Client administrators (and iSecurify staff on their behalf) answer on the **Questionnaire** tab. Answers are checked by type (yes/no/n/a, one of the listed choices, a number, a real calendar date, text up to 4000 characters).
- iSecurify staff review each answer: **accept**, or **send back** with a reason (the answerer is notified). Changing an answer returns it to *waiting for review*. "Accept all waiting" accepts everything pending in one step.
- Client staff, vendors and other organizations cannot answer; the engagement's auditor can read. Closed engagements are read-only.
- The tab shows progress (answered, required still open, to review, sent back). **Export (.csv)** lists every question with its answer and review status.

## Phase checks
Leaving *Preparation* warns about required questions still unanswered (`questionnaire_open`). Leaving *Scheduling* warns about answers waiting for review or sent back (`questionnaire_review`). Both are warnings that can be acknowledged with a reason, like the other phase checks.

## Not included
Per-question file attachments (attach files as normal evidence), conditional rules that change the checklist from an answer, and inclusion in the PDF report (the CSV export is the record for now).

## Audit
`questionnaire.uploaded`, `.published`, `.discarded`, `.answered`, `.accepted`, `.accepted_all`, `.sent_back`.

## Core, optional and industry questions (Phase 13A)
**Template columns** (download from the framework page): Ref #, Section, Question, Answer type, Choices, Required, Help text, **Core (all clients)**, **Industries**. Answer types now include **choose all** (several choices, stored as `A|B`).
- **Core = yes**: compulsory for every client. On an engagement a core question cannot be edited or removed, by anyone (API refuses with 403; the database refuses even raw SQL). Keep this set small: what you need to size and run every engagement.
- **Industries**: blank or `All` = every industry; otherwise one or more of IT / SaaS, BFSI, Healthcare, Manufacturing, Retail / E-commerce, Education, Telecom, Public sector, Other (separate with `|`).
- Required is separate from Core: a required question must be answered, a core question must stay.

**On an engagement** (iSecurify staff only; clients and auditors cannot change structure):
- **Industry** selector on the Questionnaire tab. Setting it adds the framework's questions tagged for that industry; it never removes anything. A new engagement copies core questions and untagged questions, plus those matching the industry if it is already set.
- **Add question**: pick from the framework's standard list (questions not in this engagement) or write a new one for this client (refs `CUS-1`, `CUS-2`...).
- **Edit** (wording, section, help, required; the answer type and, once answered, the choices are fixed) and **Remove** (needs a reason) apply to non-core questions only. Removal is soft: the question and any answer are kept, it leaves the progress counts, cannot be answered, and can be **restored**. The CSV marks it `removed`.
- Everything is audited: `questionnaire.industry_set`, `.questions_added`, `.question_added`, `.question_edited`, `.question_removed`, `.question_restored`.
- A newer questionnaire version still never changes an engagement that already has its copy.

**Shipped questionnaires** (`docs/questionnaires/`): `DPDP_Engagement_Questionnaire.xlsx` (86 questions, 40 core, 11 industry-tagged) and `ISO27001_2022_Engagement_Questionnaire.xlsx` (63 questions, 30 core, 10 industry-tagged). Upload each on its framework page, check the preview, save as draft and publish. Review the wording with your consultants first: they are a proposed standard, not a legal opinion.

**Fixed in 13A:** the template's header "Choices (separate with |)" was not recognised by the upload, so a downloaded template with choice questions was refused. It is now understood (text in brackets is ignored when matching headers).
