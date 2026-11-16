-- Phase 9A: optional two-person approval for control-mapping changes on PUBLISHED framework releases.
CREATE TABLE platform_settings (
  setting_key VARCHAR(64) NOT NULL PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL,
  updated_by CHAR(36) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_ps_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
INSERT INTO platform_settings(setting_key, setting_value) VALUES ('mapping_approval', 'off');
-- //
CREATE TABLE mapping_change_requests (
  id CHAR(36) NOT NULL PRIMARY KEY,
  control_id CHAR(36) NOT NULL,
  kind ENUM('set','unset') NOT NULL,
  common_control_id CHAR(36) NULL,
  rationale VARCHAR(1000) NULL,
  status ENUM('pending','approved','rejected','withdrawn') NOT NULL DEFAULT 'pending',
  requested_by CHAR(36) NOT NULL,
  requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  decided_by CHAR(36) NULL,
  decided_at DATETIME(3) NULL,
  decision_note VARCHAR(1000) NULL,
  KEY ix_mcr_status (status, requested_at),
  KEY ix_mcr_control (control_id, status),
  CONSTRAINT fk_mcr_ctl FOREIGN KEY (control_id) REFERENCES framework_controls(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mcr_cc FOREIGN KEY (common_control_id) REFERENCES common_controls(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mcr_req FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mcr_dec FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_mcr_kind CHECK ((kind = 'set') = (common_control_id IS NOT NULL)),
  CONSTRAINT chk_mcr_decided CHECK ((status = 'pending') = (decided_at IS NULL)),
  CONSTRAINT chk_mcr_dec_by CHECK (status IN ('pending','withdrawn') OR decided_by IS NOT NULL),
  CONSTRAINT chk_mcr_self CHECK (status <> 'approved' OR decided_by <> requested_by)
) ENGINE=InnoDB;
-- //
CREATE TRIGGER mcr_no_delete BEFORE DELETE ON mapping_change_requests FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'mapping change requests are never deleted'
-- //
CREATE TRIGGER mcr_decide_once BEFORE UPDATE ON mapping_change_requests FOR EACH ROW
BEGIN
  IF OLD.status <> 'pending' OR NOT (OLD.control_id <=> NEW.control_id AND OLD.kind <=> NEW.kind AND OLD.common_control_id <=> NEW.common_control_id AND OLD.requested_by <=> NEW.requested_by AND OLD.requested_at <=> NEW.requested_at AND OLD.rationale <=> NEW.rationale) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'a mapping change request is decided once and its content cannot change';
  END IF;
END;
