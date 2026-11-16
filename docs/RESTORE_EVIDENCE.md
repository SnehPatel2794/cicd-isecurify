# Restore evidence (Phase 12A)

## What was done
A populated database was built through the real API (users, two organizations, an engagement with its checklist, evidence requests, three uploaded evidence files, 40 audit events). A backup was taken in the **same layout as `deploy/backup.sh`**: a gzip'd `mysqldump --single-transaction --routines --triggers`, a tar.gz of the evidence folder and a `sha256sum` manifest. It was restored into a **new, empty database** and checked with the product's own `api/scripts/verify-restore.ts`. Then the backup was damaged on purpose in three ways. Reproduce with:

`cd api && MIGRATIONS_DIR=../migrations node --import tsx test/restore_proof.ts ./restore-proof`

Raw output: `docs/evidence-12A/restore-proof.log`. Checksums of the proof backup: `docs/evidence-12A/manifest-*.sha256`.

## Results
| Case | Expected | Result |
|---|---|---|
| Untouched backup: checksums, restore, verify | all checks pass | **PASS**: 30 migrations, 85 tables, 75 protective triggers, 163 relationships, 1 active super admin, 3 of 3 evidence files match size and SHA-256; row counts equal the source (users 9, audit events 40, evidence versions 3) |
| One evidence file altered after backup | detected | **detected**: "1 changed out of 3", exit code 1 |
| One evidence file removed | detected | **detected**: "1 missing", exit code 1 |
| Dump file damaged | refused before restore | **refused**: checksum FAILED, exit code 1 |

## What this does not prove (read this)
- It ran on **MariaDB in the build sandbox, not MySQL 8 in Docker**, and without GPG encryption, off-server copy or the real `restore.sh` / `restore-drill.sh` (these need Docker). The checks and the backup format are the product's own; the container steps are not exercised.
- The data set is small (a few files, one engagement). Timing (RTO) was not measured.
- Therefore the go-live checklist still requires **one rehearsal on the real server with a real production backup**, signed by a second person. Use this table as the template: backup name and checksum, restore start/end time, verify output, who signed.

## Signature block for the real rehearsal
| Field | Value |
|---|---|
| Backup stamp / sha256 | |
| Server and date | |
| Restore started / finished | |
| `verify-restore.ts` result (paste) | |
| Carried out by / checked by | |
