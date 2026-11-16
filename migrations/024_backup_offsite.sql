-- Phase 10E: the off-server copy is recorded in the same append-only log as backups and drills.
ALTER TABLE backup_log MODIFY kind ENUM('backup','drill','offsite') NOT NULL
