-- Phase 10A: vendor risk. Vendors belong to an organization. Each has security assessments (a fixed questionnaire, scored) and an append-only event history.
CREATE TABLE vendors (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  vendor_no INT NOT NULL,
  name VARCHAR(200) NOT NULL,
  service TEXT NOT NULL,
  category ENUM('cloud','software','professional_services','data_processing','infrastructure','hardware','other') NOT NULL,
  criticality ENUM('low','medium','high','critical') NOT NULL,
  data_access ENUM('none','internal','confidential','personal','regulated') NOT NULL,
  status ENUM('onboarding','active','offboarding','offboarded') NOT NULL DEFAULT 'onboarding',
  owner_user_id CHAR(36) NULL,
  contact_user_id CHAR(36) NULL,
  contact_name VARCHAR(200) NULL,
  contact_email VARCHAR(254) NULL,
  contract_start DATE NULL,
  contract_end DATE NULL,
  review_date DATE NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  offboarded_at DATETIME(3) NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_vendor_no (tenant_id, vendor_no),
  UNIQUE KEY uq_vendor_name (tenant_id, name),
  KEY ix_vendor_status (tenant_id, status),
  KEY ix_vendor_owner (owner_user_id, status),
  KEY ix_vendor_contact (contact_user_id),
  CONSTRAINT fk_vendor_tenant FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_vendor_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_vendor_contact FOREIGN KEY (contact_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_vendor_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_vendor_no CHECK (vendor_no >= 1),
  CONSTRAINT chk_vendor_name CHECK (CHAR_LENGTH(TRIM(name)) > 0 AND CHAR_LENGTH(TRIM(service)) > 0),
  CONSTRAINT chk_vendor_contract CHECK (contract_start IS NULL OR contract_end IS NULL OR contract_start <= contract_end),
  CONSTRAINT chk_vendor_off CHECK ((status = 'offboarded') = (offboarded_at IS NOT NULL))
) ENGINE=InnoDB;
-- //
CREATE TRIGGER vendor_no_delete BEFORE DELETE ON vendors FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'vendors are never deleted'
-- //
CREATE TRIGGER vendor_identity_immutable BEFORE UPDATE ON vendors FOR EACH ROW
BEGIN
  IF NOT (OLD.tenant_id <=> NEW.tenant_id AND OLD.vendor_no <=> NEW.vendor_no AND OLD.created_by <=> NEW.created_by AND OLD.created_at <=> NEW.created_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'vendor identity is immutable';
  END IF;
END;
-- //
CREATE TABLE vendor_assessments (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  vendor_id CHAR(36) NOT NULL,
  assessment_no INT NOT NULL,
  questionnaire_version TINYINT NOT NULL DEFAULT 1,
  status ENUM('draft','submitted','approved','rejected') NOT NULL DEFAULT 'draft',
  answers JSON NOT NULL,
  score TINYINT NULL,
  due_date DATE NULL,
  requested_by CHAR(36) NOT NULL,
  submitted_by CHAR(36) NULL,
  submitted_at DATETIME(3) NULL,
  reviewed_by CHAR(36) NULL,
  reviewed_at DATETIME(3) NULL,
  review_note TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  open_marker TINYINT AS (CASE WHEN status IN ('draft','submitted') THEN 1 ELSE NULL END) STORED,
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_va_no (tenant_id, vendor_id, assessment_no),
  UNIQUE KEY uq_va_open (tenant_id, vendor_id, open_marker),
  KEY ix_va_status (tenant_id, status),
  CONSTRAINT fk_va_vendor FOREIGN KEY (tenant_id, vendor_id) REFERENCES vendors(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_va_req FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_va_sub FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_va_rev FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_va_score CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  CONSTRAINT chk_va_submitted CHECK ((status IN ('draft')) OR (submitted_by IS NOT NULL AND submitted_at IS NOT NULL AND score IS NOT NULL)),
  CONSTRAINT chk_va_reviewed CHECK ((status IN ('approved','rejected')) = (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  CONSTRAINT chk_va_four_eyes CHECK (reviewed_by IS NULL OR submitted_by IS NULL OR reviewed_by <> submitted_by)
) ENGINE=InnoDB;
-- //
CREATE TRIGGER va_no_delete BEFORE DELETE ON vendor_assessments FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'assessments are never deleted'
-- //
CREATE TRIGGER va_decided_frozen BEFORE UPDATE ON vendor_assessments FOR EACH ROW
BEGIN
  IF OLD.status IN ('approved','rejected') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'a decided assessment is permanent'; END IF;
  IF NOT (OLD.tenant_id <=> NEW.tenant_id AND OLD.vendor_id <=> NEW.vendor_id AND OLD.assessment_no <=> NEW.assessment_no AND OLD.requested_by <=> NEW.requested_by AND OLD.created_at <=> NEW.created_at) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'assessment identity is immutable'; END IF;
END;
-- //
CREATE TABLE vendor_events (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  vendor_id CHAR(36) NOT NULL,
  kind ENUM('created','edited','status','assessment','comment') NOT NULL,
  from_status VARCHAR(20) NULL,
  to_status VARCHAR(20) NULL,
  note TEXT NULL,
  actor_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  KEY ix_vev_vendor (tenant_id, vendor_id, created_at),
  CONSTRAINT fk_vev_vendor FOREIGN KEY (tenant_id, vendor_id) REFERENCES vendors(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_vev_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
CREATE TRIGGER vev_no_update BEFORE UPDATE ON vendor_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'vendor_events is append-only'
-- //
CREATE TRIGGER vev_no_delete BEFORE DELETE ON vendor_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'vendor_events is append-only'
-- //
ALTER TABLE notifications MODIFY entity_type ENUM('finding','evidence_request','checklist_item','certificate','risk','policy','incident','vendor') NOT NULL
