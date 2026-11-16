# Framework content and licensing

**This repository ships no standard's text.** The only framework data included is `Sample Security Framework (fictional)` (`api/src/modules/frameworks/sample.ts`), written for demos and tests. It is not derived from ISO, SOC 2, PCI DSS, HIPAA, GDPR, DPDP or NIST wording.

## What you must decide before importing real frameworks
I am not a lawyer; confirm each item with the publisher or your counsel.
| Source | Typical position (verify) |
|---|---|
| ISO/IEC 27001, 27701 | Copyrighted by ISO/IEC; the control and clause text is sold. Importing it into a platform you operate usually needs a licence that covers that use. Do not paste the standard's text into a shared or customer-visible library without one. |
| SOC 2 (AICPA Trust Services Criteria) | Published by the AICPA with its own reuse terms. Check them before reproducing criteria text. |
| PCI DSS | Published by the PCI SSC under their licence terms; check permitted reproduction. |
| HIPAA, GDPR, India DPDP Act | Laws and regulations. The legal text is generally public, but official translations, guidance and "control" paraphrases published by third parties may not be. Check the reuse policy of the source you copy from. |
| NIST CSF and other NIST publications | US government publications are generally freely reusable; confirm the current notice. |

## Safe patterns
- **Reference, don't reproduce:** keep `ref` (e.g. clause number) and write the requirement **in your own words**. Facts such as "clause 5.1 exists" are not protected; the standard's sentences may be.
- **Customer-supplied content:** a customer who owns a licence imports their own copy. Use a separate framework per licence holder if the terms require it.
- **Keep provenance:** the import writes an audit event with the file name and SHA-256; record the licence/source in the framework `description`.
- **Visibility:** the library is readable only by iSecurify platform users; customers see only the checklist of their own engagement (Phase 4+).
- Published releases are permanent. If licensed text is imported by mistake, ask an engineer to follow your retention policy: removing a published release requires a deliberate database operation (the triggers intentionally block the API and application account).
