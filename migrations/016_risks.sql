-- Phase 9B: risk register. Risks belong to an organization; they can be linked to findings and checklist items; every change is an append-only event.
CREATE TABLE risks (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  risk_no INT NOT NULL,
  title VARCHAR(300) NOT NULL,
  description TEXT NOT NULL,
  category ENUM('strategic','operational','compliance','security','privacy','vendor','financial','other') NOT NULL,
  likelihood TINYINT NOT NULL,
  impact TINYINT NOT NULL,
  residual_likelihood TINYINT NULL,
  residual_impact TINYINT NULL,
  status ENUM('identified','treating','accepted','closed') NOT NULL DEFAULT 'identified',
  treatment ENUM('mitigate','accept','transfer','avoid') NULL,
  treatment_plan TEXT NULL,
  owner_user_id CHAR(36) NULL,
  review_date DATE NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  closed_at DATETIME(3) NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_risk_no (tenant_id, risk_no),
  KEY ix_risk_status (tenant_id, status),
  KEY ix_risk_owner (owner_user_id, status),
  CONSTRAINT fk_risk_tenant FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_risk_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_risk_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_risk_no CHECK (risk_no >= 1),
  CONSTRAINT chk_risk_text CHECK (CHAR_LENGTH(TRIM(title)) > 0 AND CHAR_LENGTH(TRIM(description)) > 0),
  CONSTRAINT chk_risk_scale CHECK (likelihood BETWEEN 1 AND 5 AND impact BETWEEN 1 AND 5),
  CONSTRAINT chk_risk_resid CHECK ((residual_likelihood IS NULL) = (residual_impact IS NULL) AND (residual_likelihood IS NULL OR (residual_likelihood BETWEEN 1 AND 5 AND residual_impact BETWEEN 1 AND 5))),
  CONSTRAINT chk_risk_closed CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
  CONSTRAINT chk_risk_treating CHECK (status NOT IN ('treating','accepted') OR treatment IS NOT NULL),
  CONSTRAINT chk_risk_accepted CHECK (status <> 'accepted' OR (treatment = 'accept' AND review_date IS NOT NULL AND residual_likelihood IS NOT NULL))
) ENGINE=InnoDB;
-- //
CREATE TRIGGER risk_no_delete BEFORE DELETE ON risks FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'risks are never deleted'
-- //
CREATE TRIGGER risk_identity_immutable BEFORE UPDATE ON risks FOR EACH ROW
BEGIN
  IF NOT (OLD.tenant_id <=> NEW.tenant_id AND OLD.risk_no <=> NEW.risk_no AND OLD.created_by <=> NEW.created_by AND OLD.created_at <=> NEW.created_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'risk identity is immutable';
  END IF;
END;
-- //
CREATE TABLE risk_links (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  risk_id CHAR(36) NOT NULL,
  finding_id CHAR(36) NULL,
  engagement_id CHAR(36) NULL,
  item_id CHAR(36) NULL,
  linked_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_rl_finding (tenant_id, risk_id, finding_id),
  UNIQUE KEY uq_rl_item (tenant_id, risk_id, item_id),
  KEY ix_rl_finding (tenant_id, finding_id),
  KEY ix_rl_item (tenant_id, item_id),
  CONSTRAINT fk_rl_risk FOREIGN KEY (tenant_id, risk_id) REFERENCES risks(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_rl_finding FOREIGN KEY (tenant_id, finding_id) REFERENCES findings(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_rl_item FOREIGN KEY (tenant_id, engagement_id, item_id) REFERENCES checklist_items(tenant_id, engagement_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_rl_by FOREIGN KEY (linked_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_rl_one CHECK ((finding_id IS NOT NULL) <> (item_id IS NOT NULL) AND ((item_id IS NULL) = (engagement_id IS NULL)))
) ENGINE=InnoDB;
-- //
CREATE TABLE risk_events (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  risk_id CHAR(36) NOT NULL,
  kind ENUM('created','edited','rated','assigned','status','link','unlink','comment') NOT NULL,
  from_status VARCHAR(20) NULL,
  to_status VARCHAR(20) NULL,
  note TEXT NULL,
  actor_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  KEY ix_re_risk (tenant_id, risk_id, created_at),
  CONSTRAINT fk_rev_risk FOREIGN KEY (tenant_id, risk_id) REFERENCES risks(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_rev_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_rev_status CHECK (kind <> 'status' OR (to_status IS NOT NULL AND from_status IS NOT NULL))
) ENGINE=InnoDB;
-- //
CREATE TRIGGER rev_no_update BEFORE UPDATE ON risk_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'risk events are append-only'
-- //
CREATE TRIGGER rev_no_delete BEFORE DELETE ON risk_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'risk events are append-only'
-- //
ALTER TABLE notifications MODIFY entity_type ENUM('finding','evidence_request','checklist_item','certificate','risk') NOT NULL
