#!/usr/bin/env bash
# One-time Ubuntu 22.04/24.04 hardening + Docker install. Review before running; run as root.
set -euo pipefail
apt-get update && apt-get install -y ca-certificates curl ufw fail2ban unattended-upgrades gnupg
curl -fsSL https://get.docker.com | sh
ufw default deny incoming; ufw default allow outgoing; ufw allow OpenSSH; ufw allow 80/tcp; ufw allow 443/tcp; ufw --force enable
systemctl enable --now fail2ban; dpkg-reconfigure -f noninteractive unattended-upgrades
# 2 GB swap as a safety net (MySQL buffer pool is capped at 1 GB so swapping should stay rare)
[ -f /swapfile ] || { fallocate -l 2G /swapfile; chmod 600 /swapfile; mkswap /swapfile; swapon /swapfile; echo '/swapfile none swap sw 0 0' >> /etc/fstab; }
echo "done. Next: cp .env.example .env, fill it, then: docker compose up -d --build"
