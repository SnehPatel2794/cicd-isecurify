# Installing iSecurify GRC on your Ubuntu server: step by step

**Give your DevOps engineer one file: `isecurify-grc-13A.zip`** (the full project). The `patch` file is only for a server that already runs an earlier version; a new server does not need it.

## Before you start
- Ubuntu 22.04 or 24.04, 2 vCPU, 4 GB RAM, 40 GB disk or more, a user with sudo.
- A domain name (for example `grc.yourcompany.com`) with a DNS **A record** pointing at the server's public IP. Ports 80 and 443 must be reachable from the internet (the certificate is issued automatically).
- An email mailbox for sending (Google Workspace App Password) if you want invitation and reminder emails.

## Steps (DevOps)
1. **Upload** the zip: `scp isecurify-grc-13A.zip youruser@SERVER:~/`
2. **Unpack:** `sudo apt-get install -y unzip && unzip isecurify-grc-13A.zip && cd grc`
3. **Prepare the server:** `sudo bash deploy/server-setup.sh` (Docker, firewall, fail2ban, automatic security updates). Log out and back in so the Docker group applies.
4. **Settings:** `cp .env.example .env && chmod 600 .env && nano .env`. Set `DOMAIN`, the four database passwords (made with `openssl rand -hex 24`: letters and digits only) and `MFA_ENC_KEY` / `CSRF_KEY`. Optional: set `PURGE_DB_PASSWORD` (a fifth random password) if the Super Admin should be able to wipe demo organizations (docs/DEMO_DATA.md); leave it empty otherwise. The file shows the command that makes each random value (`openssl rand -base64 32`). Use a different value for each. Add the SMTP lines if you have them. **Never send `.env` by chat or email.**
5. **Start:** `docker compose up -d --build` (the first build takes several minutes). Then `docker compose ps`: everything should be running or healthy.
6. **Check:** `deploy/smoke.sh https://YOUR_DOMAIN --expect-env production` and `deploy/verify-readonly.sh`. Both should end with a pass.
7. **Backups:** `sudo bash deploy/install-cron.sh --user $USER`. Read `docs/RUNBOOK.md` about the GPG key and the off-server copy.
8. **First sign-in** (next section), then work through `docs/GO_LIVE.md`.

## Your Super Admin sign-in
There is **no preset user name or password**, on purpose: a published default password would be a hole. The first person to open `https://YOUR_DOMAIN` after the first start sees **"Create the first Super Admin"** and chooses their own name, email and password (12+ characters, upper and lower case, a digit). That person becomes the Super Admin and then sets up two-step verification (an authenticator app) at the next screen.

- **You should do this step yourself**, immediately after step 6, so nobody else can. After the first account exists the page closes permanently.
- Save the password and the recovery codes in your password manager.
- Locked out later: the server owner runs `docker compose run --rm api npx tsx scripts/recover-admin.ts --email you@yourcompany.com` and gets a one-time link.

## After sign-in (about 15 minutes)
1. Branding: upload your logo if you want a different one. The product already shows the shield logo and name when none is uploaded (`web/public/logo-shield.png`; a white version for dark backgrounds is `logo-shield-white.png`).
2. Email delivery: send a test mail. 3. System status: all green. 4. Import and publish frameworks. 5. Create the first organization.

## Later updates
Send only the small patch file (`docs/DEPLOY.md` section 3, `docs/RELEASE.md`).

## If something does not start (13C.1)
`docker compose ps` shows what is running. For a container that keeps restarting: `docker compose logs <name> --tail 40` (names: mysql, bootstrap, init, api, worker, web). Send that output with the step you were on.
- **web restarting, "Unexpected next token after '{'":** a Caddyfile fault fixed in 13C.1. Install 13C.1.
- **worker restarting, "Cannot find module ... vapt/rules":** fixed in 13C.1.
- **bootstrap fails:** check the database passwords contain only letters and digits, and that `MYSQL_ROOT_PASSWORD` was not changed after the first start (that needs `docker compose down -v` on a fresh install only: it deletes the database).
