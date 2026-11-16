# Putting iSecurify GRC on a server, and updating it

Written for the person who runs the Ubuntu server (devops). Everything runs in Docker; nothing is installed on the host except Docker.

## 1. What to hand over

**First install: one file, the full release `isecurify-grc-<version>.zip`.** It contains the source, the Docker files, the database migrations, the deploy scripts and the docs. It does not contain `node_modules`, builds or any secret. Docker builds the app on the server.

**Every later update: one small file, a patch `isecurify-grc-patch-<from>-to-<to>.tar.gz`**, plus its SHA-256 line (printed when the patch is made). A patch holds only the files that changed. You never need to re-upload the whole project.

## 2. First install (Ubuntu 22.04 or 24.04)

Server: 2 vCPU, 4 GB RAM, 40 GB disk (more if you keep a lot of evidence), a DNS `A` record for your domain pointing at it, ports 80 and 443 open.

```bash
sudo apt-get install -y unzip
unzip isecurify-grc-<version>.zip && cd grc
sudo bash deploy/server-setup.sh          # Docker, firewall, fail2ban, automatic security updates, swap. Read it first.
cp .env.example .env && nano .env         # DOMAIN, the 3 database passwords, MFA_ENC_KEY, CSRF_KEY (commands are in the file)
docker compose up -d --build              # builds, runs migrations, starts everything; HTTPS certificate is automatic
sudo bash deploy/install-cron.sh --user $USER   # nightly backup, weekly restore drill, 10-minute health probe
```
Open `https://YOUR_DOMAIN` and create the first Super Admin. Then see `docs/RUNBOOK.md` (backups, restore, recovery) and `docs/EMAIL.md` (Google Workspace SMTP).

Optional: `WEBHOOK_ENC_KEY` in `.env` turns on outgoing webhooks (`docs/WEBHOOKS.md`). `docker compose --profile scan up -d` adds the malware scanner (`docs/EVIDENCE.md`).

Keep `.env` out of version control and out of chat. It is never part of a release or a patch.

## 3. Updating with a patch

Upload the patch to the server (any folder), then from the project folder:

```bash
sha256sum isecurify-grc-patch-A-to-B.tar.gz          # compare with the checksum you were given
deploy/apply-patch.sh /path/to/isecurify-grc-patch-A-to-B.tar.gz --dry-run   # shows exactly what would change; changes nothing
deploy/apply-patch.sh /path/to/isecurify-grc-patch-A-to-B.tar.gz
```

The script, in order:
1. Checks the patch is for the version installed here (`cat VERSION`) and has not been damaged in transit.
2. Checks nobody edited, on the server, any file the patch will replace. If so it stops and lists them (`--force` overwrites; the old copy is kept).
3. Checks `.env` has every new **required** setting and names any that are missing. Add them, then run it again.
4. Takes a backup (`deploy/backup.sh`). If the backup fails, nothing is changed.
5. Replaces the files, rebuilds only the images that changed, restarts, and waits for the app to report ready. Migrations run automatically as part of the restart.
6. If the app does not come up, it puts the previous files back by itself and rebuilds them.

A log of every run is in `.patches/history.log`.

**Undo a patch that applied but you want gone:** `deploy/apply-patch.sh --rollback`. This restores the previous *files*. Database changes made by migrations are forward-only and are not undone; if a patch with migrations must be reverted, restore the backup taken in step 4 (`deploy/restore.sh`, see the runbook).

Rules of thumb:
- Apply patches **in order**. A patch says which version it needs; if the server is on a different one it refuses. If you have fallen behind, ask for the patch from your version, or install the newest full release in a fresh folder.
- Never edit files inside the project folder on the server. Put local settings in `.env`.
- Documentation-only patches change files and restart nothing.

## 4. Making patches (for whoever prepares releases)

Every release has a `VERSION` file and a `MANIFEST.sha256` (a checksum of each file). To make a release and its patch:

```bash
bash deploy/make-manifest.sh path/to/new-release 11C      # stamp the release; then zip the folder
bash deploy/make-patch.sh old-release.zip new-release.zip ./out
```
`make-patch.sh` prints what the patch contains: what to rebuild, whether there are migrations, whether `docker-compose.yml` changed, and which new `.env` settings are needed. Both inputs may be zip files or folders, and both must carry a `VERSION`.

## 5. What has and has not been proven

The patch tools are tested (`api/test/52_patch_scripts.test.ts`) against small sample releases with a stand-in for `docker`: building the patch, a dry run, a normal apply, refusal on the wrong version / a damaged patch / local edits / a missing setting / a failed backup, automatic rollback when the app does not come up, manual rollback, docs-only and web-only patches, and the script updating itself. They have **not** run against a real Docker host here; do the first patch on a staging copy or at a quiet time and read `.patches/history.log`.


See also `docs/RELEASE.md` (release steps, read-only containers, logs) and `docs/STAGING.md`.

Release documents: `docs/ADMIN_GUIDE.md`, `docs/CLIENT_GUIDE.md`, `docs/GO_LIVE.md`, `docs/READINESS.md`, `docs/RESTORE_EVIDENCE.md`.
