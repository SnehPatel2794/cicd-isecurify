-- Phase 8C: VAPT / scanner results imported into findings. One append-only record per import, and findings remember where they came from.
CREATE TABLE finding_imports (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  source_name VARCHAR(200) NOT NULL,
  format ENUM('csv','json') NOT NULL,
  sha256 CHAR(64) NOT NULL,
  total_rows INT NOT NULL,
  created_count INT NOT NULL,
  duplicate_count INT NOT NULL,
  invalid_count INT NOT NULL,
  imported_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_fi_id (id),
  KEY ix_fi_eng (tenant_id, engagement_id, created_at),
  CONSTRAINT fk_fi_eng FOREIGN KEY (tenant_id, engagement_id) REFERENCES engagements(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_fi_user FOREIGN KEY (imported_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_fi_hash CHECK (sha256 REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT chk_fi_counts CHECK (total_rows >= 0 AND created_count >= 0 AND duplicate_count >= 0 AND invalid_count >= 0 AND created_count + duplicate_count + invalid_count <= total_rows)
) ENGINE=InnoDB;
-- //
CREATE TRIGGER fi_no_update BEFORE UPDATE ON finding_imports FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'finding_imports is append-only'
-- //
CREATE TRIGGER fi_no_delete BEFORE DELETE ON finding_imports FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'finding_imports is append-only'
-- //
ALTER TABLE findings ADD COLUMN import_id CHAR(36) NULL, ADD COLUMN import_key CHAR(64) NULL, ADD UNIQUE KEY uq_f_import_key (tenant_id, engagement_id, import_key)
-- //
ALTER TABLE findings ADD CONSTRAINT fk_f_import FOREIGN KEY (import_id) REFERENCES finding_imports(id) ON DELETE RESTRICT

-- //
DROP TRIGGER f_identity_immutable
-- //
CREATE TRIGGER f_identity_immutable BEFORE UPDATE ON findings FOR EACH ROW
BEGIN
  IF NOT (OLD.engagement_id <=> NEW.engagement_id AND OLD.item_id <=> NEW.item_id AND OLD.finding_no <=> NEW.finding_no AND OLD.raised_by <=> NEW.raised_by AND OLD.tenant_id <=> NEW.tenant_id AND OLD.created_at <=> NEW.created_at AND OLD.import_id <=> NEW.import_id AND OLD.import_key <=> NEW.import_key) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'finding identity is immutable';
  END IF;
END;
