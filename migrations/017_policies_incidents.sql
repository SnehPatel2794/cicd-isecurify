-- Phase 9C: policy management (versions, approval by a second person, acknowledgement) and the incident register.
CREATE TABLE policies (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  policy_no INT NOT NULL,
  title VARCHAR(300) NOT NULL,
  category ENUM('security','privacy','hr','operations','compliance','other') NOT NULL,
  audience ENUM('staff','everyone') NOT NULL DEFAULT 'staff',
  review_months TINYINT NOT NULL DEFAULT 12,
  owner_user_id CHAR(36) NOT NULL,
  archived_at DATETIME(3) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_policy_no (tenant_id, policy_no),
  KEY ix_policy_owner (owner_user_id),
  CONSTRAINT fk_policy_tenant FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_policy_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_policy_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_policy_no CHECK (policy_no >= 1),
  CONSTRAINT chk_policy_title CHECK (CHAR_LENGTH(TRIM(title)) > 0),
  CONSTRAINT chk_policy_review CHECK (review_months BETWEEN 1 AND 36)
) ENGINE=InnoDB;
-- //
CREATE TRIGGER policy_no_delete BEFORE DELETE ON policies FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'policies are never deleted'
-- //
CREATE TRIGGER policy_identity_immutable BEFORE UPDATE ON policies FOR EACH ROW
BEGIN
  IF NOT (OLD.tenant_id <=> NEW.tenant_id AND OLD.policy_no <=> NEW.policy_no AND OLD.created_by <=> NEW.created_by AND OLD.created_at <=> NEW.created_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'policy identity is immutable';
  END IF;
END;
-- //
CREATE TABLE policy_versions (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  policy_id CHAR(36) NOT NULL,
  version_no INT NOT NULL,
  body TEXT NOT NULL,
  change_summary VARCHAR(1000) NULL,
  status ENUM('draft','in_review','published','superseded') NOT NULL DEFAULT 'draft',
  author_id CHAR(36) NOT NULL,
  submitted_at DATETIME(3) NULL,
  approved_by CHAR(36) NULL,
  published_at DATETIME(3) NULL,
  next_review_date DATE NULL,
  open_key TINYINT NULL,
  live_key TINYINT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_pv_no (tenant_id, policy_id, version_no),
  UNIQUE KEY uq_pv_open (tenant_id, policy_id, open_key),
  UNIQUE KEY uq_pv_live (tenant_id, policy_id, live_key),
  CONSTRAINT fk_pv_policy FOREIGN KEY (tenant_id, policy_id) REFERENCES policies(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_pv_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pv_approver FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_pv_body CHECK (CHAR_LENGTH(TRIM(body)) > 0),
  CONSTRAINT chk_pv_open CHECK ((status IN ('draft','in_review')) = (open_key IS NOT NULL)),
  CONSTRAINT chk_pv_live CHECK ((status = 'published') = (live_key IS NOT NULL)),
  CONSTRAINT chk_pv_approved CHECK (status IN ('draft','in_review') OR (approved_by IS NOT NULL AND approved_by <> author_id AND published_at IS NOT NULL AND next_review_date IS NOT NULL)),
  CONSTRAINT chk_pv_unapproved CHECK (status NOT IN ('draft','in_review') OR (approved_by IS NULL AND published_at IS NULL)),
  CONSTRAINT chk_pv_submitted CHECK (status <> 'in_review' OR submitted_at IS NOT NULL)
) ENGINE=InnoDB;
-- //
CREATE TRIGGER pv_no_delete BEFORE DELETE ON policy_versions FOR EACH ROW
BEGIN
  IF OLD.status <> 'draft' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'only a draft version can be discarded'; END IF;
END;
-- //
CREATE TRIGGER pv_guard BEFORE UPDATE ON policy_versions FOR EACH ROW
BEGIN
  IF NOT (OLD.tenant_id <=> NEW.tenant_id AND OLD.policy_id <=> NEW.policy_id AND OLD.version_no <=> NEW.version_no AND OLD.author_id <=> NEW.author_id AND OLD.created_at <=> NEW.created_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'policy version identity is immutable';
  END IF;
  IF OLD.status <> 'draft' AND NOT (OLD.body <=> NEW.body AND OLD.change_summary <=> NEW.change_summary) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'a submitted or published version cannot be edited';
  END IF;
  IF OLD.status = 'superseded' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'superseded versions are final'; END IF;
  IF OLD.status = 'published' AND NEW.status NOT IN ('published','superseded') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'a published version can only be superseded'; END IF;
  IF OLD.approved_by IS NOT NULL AND NOT (OLD.approved_by <=> NEW.approved_by AND OLD.published_at <=> NEW.published_at AND OLD.next_review_date <=> NEW.next_review_date) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'approval details are permanent';
  END IF;
END;
-- //
CREATE TABLE policy_acks (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  policy_id CHAR(36) NOT NULL,
  version_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  acknowledged_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_ack (tenant_id, version_id, user_id),
  KEY ix_ack_user (user_id),
  CONSTRAINT fk_ack_version FOREIGN KEY (tenant_id, version_id) REFERENCES policy_versions(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ack_policy FOREIGN KEY (tenant_id, policy_id) REFERENCES policies(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ack_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
CREATE TRIGGER ack_no_update BEFORE UPDATE ON policy_acks FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'acknowledgements are permanent'
-- //
CREATE TRIGGER ack_no_delete BEFORE DELETE ON policy_acks FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'acknowledgements are permanent'
-- //
CREATE TABLE policy_events (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  policy_id CHAR(36) NOT NULL,
  kind ENUM('created','drafted','edited','submitted','rejected','withdrawn','published','discarded','assigned','archived','restored','comment') NOT NULL,
  version_no INT NULL,
  note TEXT NULL,
  actor_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  KEY ix_pe_policy (tenant_id, policy_id, created_at),
  CONSTRAINT fk_pe_policy FOREIGN KEY (tenant_id, policy_id) REFERENCES policies(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_pe_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
CREATE TRIGGER pe_no_update BEFORE UPDATE ON policy_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'policy events are append-only'
-- //
CREATE TRIGGER pe_no_delete BEFORE DELETE ON policy_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'policy events are append-only'
-- //
CREATE TABLE incidents (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  incident_no INT NOT NULL,
  title VARCHAR(300) NOT NULL,
  description TEXT NOT NULL,
  category ENUM('security_breach','data_loss','malware','phishing','availability','physical','privacy','other') NOT NULL,
  severity ENUM('low','medium','high','critical') NOT NULL,
  status ENUM('reported','investigating','contained','resolved','closed') NOT NULL DEFAULT 'reported',
  occurred_at DATETIME(3) NULL,
  detected_at DATETIME(3) NOT NULL,
  reported_by CHAR(36) NOT NULL,
  owner_user_id CHAR(36) NULL,
  notifiable TINYINT(1) NOT NULL DEFAULT 0,
  authority_notified_at DATETIME(3) NULL,
  root_cause TEXT NULL,
  corrective_actions TEXT NULL,
  lessons TEXT NULL,
  contained_at DATETIME(3) NULL,
  resolved_at DATETIME(3) NULL,
  closed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_inc_no (tenant_id, incident_no),
  KEY ix_inc_status (tenant_id, status),
  KEY ix_inc_owner (owner_user_id, status),
  CONSTRAINT fk_inc_tenant FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_inc_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_inc_by FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_inc_no CHECK (incident_no >= 1),
  CONSTRAINT chk_inc_text CHECK (CHAR_LENGTH(TRIM(title)) > 0 AND CHAR_LENGTH(TRIM(description)) > 0),
  CONSTRAINT chk_inc_time CHECK (occurred_at IS NULL OR occurred_at <= detected_at),
  CONSTRAINT chk_inc_owner CHECK (status NOT IN ('investigating','contained','resolved') OR owner_user_id IS NOT NULL),
  CONSTRAINT chk_inc_resolved CHECK (status NOT IN ('resolved') OR (root_cause IS NOT NULL AND resolved_at IS NOT NULL)),
  CONSTRAINT chk_inc_closed CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
  CONSTRAINT chk_inc_notif CHECK (authority_notified_at IS NULL OR notifiable = 1)
) ENGINE=InnoDB;
-- //
CREATE TRIGGER inc_no_delete BEFORE DELETE ON incidents FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'incidents are never deleted'
-- //
CREATE TRIGGER inc_identity_immutable BEFORE UPDATE ON incidents FOR EACH ROW
BEGIN
  IF NOT (OLD.tenant_id <=> NEW.tenant_id AND OLD.incident_no <=> NEW.incident_no AND OLD.reported_by <=> NEW.reported_by AND OLD.created_at <=> NEW.created_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'incident identity is immutable';
  END IF;
END;
-- //
CREATE TABLE incident_risks (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  incident_id CHAR(36) NOT NULL,
  risk_id CHAR(36) NOT NULL,
  linked_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_ir (tenant_id, incident_id, risk_id),
  KEY ix_ir_risk (tenant_id, risk_id),
  CONSTRAINT fk_ir_inc FOREIGN KEY (tenant_id, incident_id) REFERENCES incidents(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ir_risk FOREIGN KEY (tenant_id, risk_id) REFERENCES risks(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ir_by FOREIGN KEY (linked_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
CREATE TABLE incident_events (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  incident_id CHAR(36) NOT NULL,
  kind ENUM('created','edited','triaged','assigned','status','link','unlink','comment') NOT NULL,
  from_status VARCHAR(20) NULL,
  to_status VARCHAR(20) NULL,
  note TEXT NULL,
  actor_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  KEY ix_ie_inc (tenant_id, incident_id, created_at),
  CONSTRAINT fk_ie_inc FOREIGN KEY (tenant_id, incident_id) REFERENCES incidents(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ie_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_ie_status CHECK (kind <> 'status' OR (to_status IS NOT NULL AND from_status IS NOT NULL))
) ENGINE=InnoDB;
-- //
CREATE TRIGGER ie_no_update BEFORE UPDATE ON incident_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'incident events are append-only'
-- //
CREATE TRIGGER ie_no_delete BEFORE DELETE ON incident_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'incident events are append-only'
-- //
ALTER TABLE notifications MODIFY entity_type ENUM('finding','evidence_request','checklist_item','certificate','risk','policy','incident') NOT NULL
