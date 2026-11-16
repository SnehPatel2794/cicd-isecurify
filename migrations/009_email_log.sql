-- Phase 7A: delivery log for outgoing email. One row per message that was SENT, and one per message that FAILED for good (after the last retry).
-- It never contains a message body, a link or a token: only who it went to, which template, the outcome and the error text. Append-only.
CREATE TABLE email_log (
  id BIGINT NOT NULL AUTO_INCREMENT,
  job_id BIGINT NULL,
  template VARCHAR(60) NOT NULL,
  to_email VARCHAR(190) NOT NULL,
  subject VARCHAR(300) NOT NULL,
  status ENUM('sent','failed') NOT NULL,
  message_id VARCHAR(300) NULL,
  error VARCHAR(500) NULL,
  attempts INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_el_created (created_at),
  KEY ix_el_job (job_id, status),
  KEY ix_el_to (to_email, created_at),
  CONSTRAINT chk_el_error CHECK (status <> 'failed' OR error IS NOT NULL)
) ENGINE=InnoDB;
-- //
CREATE TRIGGER el_no_update BEFORE UPDATE ON email_log FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'email log is append-only';
-- //
CREATE TRIGGER el_no_delete BEFORE DELETE ON email_log FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'email log is append-only';
