# Framework library design (Phase 3)

## Model
`frameworks` → `framework_releases` (v1, v2…; `draft` or `published`) → `framework_controls`. Global data (not tenant-owned): only iSecurify platform users read it; customers will see copies through their engagement (Phase 4).

## Immutability (enforced twice)
1. **API:** all control/import/publish routes load the release inside a transaction and refuse anything but a draft of a non-archived framework (409 `release_immutable` / `framework_archived`).
2. **MySQL triggers** on `framework_controls` and `framework_releases` block INSERT/UPDATE/DELETE once the parent release is published, including moving a control *into* a published release. The application DB account cannot bypass them; tested with raw SQL.
There are no DELETE routes for frameworks or releases. Frameworks are archived (hidden, read-only), never removed.

## Changing a published framework
`POST /releases/:id/new-draft` copies controls **and their common-control mappings** into the next version. Only one open draft per framework: enforced by a unique generated column (`open_draft_key`), so it holds even under concurrent requests. Publishing locks it. Old engagements keep pointing at the release they were built from (Phase 4).

## Comparison
`GET /releases/:id/compare/:otherId` returns added / removed / changed (field-level) / unchanged-count. Ordering is by code-point order of the control ID, never locale or insertion order, so the same two releases always give byte-identical output (tested).

## Import (CSV / Excel)
- **Preview** (`POST /releases/:id/import`) never writes. **Confirm** (`?confirm=true`) re-reads the same upload and inserts only the valid rows in one transaction; a re-check inside the transaction refuses to proceed if the draft changed meanwhile.
- Header row auto-detected in the first 6 rows (needs Ref, Domain, Requirement; aliases such as "Ref #", "Domain / Clause", "Requirement text" work). Optional: Owner (Department), Evidence / Reference, Additional Evidence Notes, Remarks. Other columns (e.g. Status) are ignored and not inspected.
- Limits and defences: .csv/.xlsx only; content must match the extension (no CSV that is a zip/PDF/binary, no xlsx that is not a zip); 5 MB; 5,000 rows; UTF-8 CSV with comma/semicolon/tab delimiters; **zip-bomb guard** (central directory scanned before any decompression, 50 MB expanded cap, 1,000 parts); **formula-injection guard** (cells starting `=` `+` `-` `@` or tab are refused, not rewritten); duplicate refs inside the file or already in the draft are refused; per-row errors are returned.
- Excel parsing uses `read-excel-file` (not `xlsx`/SheetJS, whose npm release carries unpatched high-severity advisories). `npm audit` is clean.

## Common controls
One common control = one authoritative requirement that several frameworks' controls map to (`control_mappings`, one mapping per control). Mapping is **metadata**: it can be changed after a release is published without touching the immutable control row, and every map/change/unmap is written to the append-only `control_mapping_history` (also insert-only for the app DB account). Phase 4 merges evidence across frameworks using these links *at engagement creation time* and records the links used, so later edits never rewrite an existing engagement.
