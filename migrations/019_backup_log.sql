-- Phase 9E: record of backups and restore drills. Written by deploy/backup.sh and deploy/restore-drill.sh (database root); the application can only read it.
CREATE TABLE backup_log (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kind ENUM('backup','drill') NOT NULL,
  ok TINYINT(1) NOT NULL,
  taken_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  db_bytes BIGINT NULL,
  evidence_bytes BIGINT NULL,
  encrypted TINYINT(1) NOT NULL DEFAULT 0,
  note VARCHAR(500) NULL,
  KEY ix_backup_kind (kind, taken_at)
) ENGINE=InnoDB;
-- //
CREATE TRIGGER backup_log_no_update BEFORE UPDATE ON backup_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'backup log is append-only'
-- //
CREATE TRIGGER backup_log_no_delete BEFORE DELETE ON backup_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'backup log is append-only'
