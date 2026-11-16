-- Phase 8A: a record of every report or workbook exported from an engagement.
-- The file itself is NOT stored. The record holds its SHA-256, so anyone can later check that a PDF or workbook they were given is exactly
-- what the platform produced (the browser hashes the file; nothing is uploaded) and who produced it and when. Append-only.
CREATE TABLE report_exports (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  format ENUM('pdf','xlsx') NOT NULL,
  sha256 CHAR(64) NOT NULL,
  size_bytes BIGINT NOT NULL,
  counts JSON NULL,
  engagement_status ENUM('active','closed') NOT NULL,
  generated_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_re_id (id),
  KEY ix_re_eng (tenant_id, engagement_id, created_at),
  KEY ix_re_hash (tenant_id, sha256),
  CONSTRAINT fk_re_eng FOREIGN KEY (tenant_id, engagement_id) REFERENCES engagements(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_re_user FOREIGN KEY (generated_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_re_hash CHECK (sha256 REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB;
-- //
CREATE TRIGGER re_no_update BEFORE UPDATE ON report_exports FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'report_exports is append-only'
-- //
CREATE TRIGGER re_no_delete BEFORE DELETE ON report_exports FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'report_exports is append-only'
