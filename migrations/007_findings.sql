-- Phase 6: audit findings. A finding is raised by the auditor against a checklist item, remediated by its owner, retested and closed by the auditor.
-- Rows are never deleted. Every change adds an append-only EVENT with who, what and the mandatory note. Portable MySQL 8 SQL, composite (tenant_id, ...) keys.
CREATE TABLE findings (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  item_id CHAR(36) NOT NULL,
  finding_no INT NOT NULL,
  title VARCHAR(300) NOT NULL,
  description TEXT NOT NULL,
  recommendation TEXT NULL,
  severity ENUM('critical','high','medium','low','observation') NOT NULL,
  status ENUM('open','in_remediation','ready_for_retest','closed','risk_accepted','cancelled') NOT NULL DEFAULT 'open',
  owner_user_id CHAR(36) NULL,
  due_date DATE NULL,
  remediation_plan TEXT NULL,
  raised_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  closed_at DATETIME(3) NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_f_no (tenant_id, engagement_id, finding_no),
  KEY ix_f_item (tenant_id, item_id, status),
  KEY ix_f_eng (tenant_id, engagement_id, status, severity),
  KEY ix_f_owner (owner_user_id, status),
  CONSTRAINT fk_f_item FOREIGN KEY (tenant_id, engagement_id, item_id) REFERENCES checklist_items(tenant_id, engagement_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_f_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_f_by FOREIGN KEY (raised_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_f_no CHECK (finding_no >= 1),
  CONSTRAINT chk_f_title CHECK (CHAR_LENGTH(TRIM(title)) > 0 AND CHAR_LENGTH(TRIM(description)) > 0),
  CONSTRAINT chk_f_closed CHECK ((status IN ('closed','risk_accepted','cancelled')) = (closed_at IS NOT NULL))
) ENGINE=InnoDB;
-- //
CREATE TRIGGER f_no_delete BEFORE DELETE ON findings FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'findings are never deleted';
-- //
-- Identity facts never change: which engagement/item the finding belongs to, its number, and who raised it.
CREATE TRIGGER f_identity_immutable BEFORE UPDATE ON findings FOR EACH ROW
BEGIN
  IF NOT (OLD.engagement_id <=> NEW.engagement_id AND OLD.item_id <=> NEW.item_id AND OLD.finding_no <=> NEW.finding_no AND OLD.raised_by <=> NEW.raised_by AND OLD.tenant_id <=> NEW.tenant_id AND OLD.created_at <=> NEW.created_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'finding identity is immutable';
  END IF;
END;
-- //
CREATE TABLE finding_events (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  finding_id CHAR(36) NOT NULL,
  kind ENUM('raised','status','edited','assigned','comment') NOT NULL,
  from_status VARCHAR(20) NULL,
  to_status VARCHAR(20) NULL,
  note TEXT NULL,
  actor_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  KEY ix_fe_finding (tenant_id, finding_id, created_at),
  KEY ix_fe_actor (actor_id),
  CONSTRAINT fk_fe_finding FOREIGN KEY (tenant_id, finding_id) REFERENCES findings(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_fe_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_fe_status CHECK (kind <> 'status' OR (to_status IS NOT NULL AND from_status IS NOT NULL)),
  CONSTRAINT chk_fe_comment CHECK (kind <> 'comment' OR (note IS NOT NULL AND CHAR_LENGTH(TRIM(note)) > 0))
) ENGINE=InnoDB;
-- //
CREATE TRIGGER fe_no_update BEFORE UPDATE ON finding_events FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'finding events are append-only';
-- //
CREATE TRIGGER fe_no_delete BEFORE DELETE ON finding_events FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'finding events are append-only';
