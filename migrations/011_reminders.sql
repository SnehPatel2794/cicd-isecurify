-- Phase 7C: due / overdue reminders and the email digest.
-- reminder_log makes the daily scan idempotent: one row per person, thing, stage and due date (overdue repeats once a week through `bucket`),
-- so running the scan twice, or after a crash, never nags twice. A changed due date is a new row and reminds again.
CREATE TABLE reminder_log (
  entity_type ENUM('finding','evidence_request') NOT NULL,
  entity_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  stage ENUM('due_soon','overdue') NOT NULL,
  due_date DATE NOT NULL,
  bucket INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (entity_type, entity_id, user_id, stage, due_date, bucket),
  KEY ix_rl_created (created_at),
  CONSTRAINT fk_rl_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
-- //
-- How often a person wants the email digest. A missing row means "daily". last_sent_at stops a second digest inside the same period.
CREATE TABLE user_digest (
  user_id CHAR(36) NOT NULL,
  frequency ENUM('off','daily','weekly') NOT NULL DEFAULT 'daily',
  last_sent_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_ud_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
