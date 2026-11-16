CREATE TABLE jobs (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(80) NOT NULL,
  payload JSON NULL,
  status ENUM('pending','running','done','dead') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  run_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  locked_at DATETIME(3) NULL,
  idempotency_key VARCHAR(190) NULL,
  last_error TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at DATETIME(3) NULL,
  UNIQUE KEY uq_jobs_idem (idempotency_key),
  KEY ix_jobs_claim (status, run_at, id)
) ENGINE=InnoDB;
-- //
CREATE TABLE outbox_events (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id CHAR(36) NULL,
  type VARCHAR(80) NOT NULL,
  payload JSON NULL,
  processed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_outbox_pending (processed_at, id)
) ENGINE=InnoDB;
