-- Phase 8B: compliance certificates issued by iSecurify for a closed engagement and one of its frameworks.
-- A certificate never changes after it is issued, with two exceptions that can each happen once: it can be REVOKED, or SUPERSEDED by a newer
-- certificate for the same organization and framework. Names and framework versions are copied onto the row (a certificate must keep saying
-- what it said when it was issued, even if the organization is renamed later). Nothing is ever deleted.
-- verify_code is the public identifier printed in the certificate's link and QR code; it grants nothing except a read-only status page.
CREATE TABLE certificates (
  id CHAR(36) NOT NULL,
  tenant_id CHAR(36) NOT NULL,
  serial BIGINT NOT NULL AUTO_INCREMENT,
  engagement_id CHAR(36) NOT NULL,
  framework_id CHAR(36) NOT NULL,
  organization_name VARCHAR(190) NOT NULL,
  engagement_name VARCHAR(190) NOT NULL,
  framework_name VARCHAR(190) NOT NULL,
  framework_version INT NOT NULL,
  scope TEXT NOT NULL,
  issued_on DATE NOT NULL,
  valid_until DATE NOT NULL,
  verify_code CHAR(22) NOT NULL,
  applicable_controls INT NOT NULL,
  effective_controls INT NOT NULL,
  override_reason VARCHAR(1000) NULL,
  issued_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at DATETIME(3) NULL,
  revoked_by CHAR(36) NULL,
  revoke_reason VARCHAR(1000) NULL,
  superseded_by CHAR(36) NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_cert_id (id),
  UNIQUE KEY uq_cert_serial (serial),
  UNIQUE KEY uq_cert_code (verify_code),
  KEY ix_cert_org (tenant_id, framework_id, issued_on),
  KEY ix_cert_expiry (valid_until),
  CONSTRAINT fk_cert_eng FOREIGN KEY (tenant_id, engagement_id) REFERENCES engagements(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_cert_fw FOREIGN KEY (framework_id) REFERENCES frameworks(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cert_by FOREIGN KEY (issued_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cert_rev FOREIGN KEY (revoked_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_cert_dates CHECK (valid_until > issued_on AND DATEDIFF(valid_until, issued_on) <= 1100),
  CONSTRAINT chk_cert_counts CHECK (effective_controls >= 0 AND applicable_controls >= effective_controls),
  CONSTRAINT chk_cert_override CHECK (effective_controls = applicable_controls OR (override_reason IS NOT NULL AND CHAR_LENGTH(TRIM(override_reason)) >= 10)),
  CONSTRAINT chk_cert_revoke CHECK ((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND CHAR_LENGTH(TRIM(revoke_reason)) > 0))
) ENGINE=InnoDB;
-- //
CREATE TRIGGER cert_no_delete BEFORE DELETE ON certificates FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'certificates are never deleted'
-- //
CREATE TRIGGER cert_immutable BEFORE UPDATE ON certificates FOR EACH ROW
BEGIN
  IF NOT (NEW.tenant_id <=> OLD.tenant_id AND NEW.id <=> OLD.id AND NEW.serial <=> OLD.serial AND NEW.engagement_id <=> OLD.engagement_id AND NEW.framework_id <=> OLD.framework_id AND NEW.organization_name <=> OLD.organization_name AND NEW.engagement_name <=> OLD.engagement_name
      AND NEW.framework_name <=> OLD.framework_name AND NEW.framework_version <=> OLD.framework_version AND NEW.scope <=> OLD.scope AND NEW.issued_on <=> OLD.issued_on AND NEW.valid_until <=> OLD.valid_until AND NEW.verify_code <=> OLD.verify_code
      AND NEW.applicable_controls <=> OLD.applicable_controls AND NEW.effective_controls <=> OLD.effective_controls AND NEW.override_reason <=> OLD.override_reason AND NEW.issued_by <=> OLD.issued_by AND NEW.created_at <=> OLD.created_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'a certificate cannot be changed after it is issued';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NOT (NEW.revoked_at <=> OLD.revoked_at AND NEW.revoked_by <=> OLD.revoked_by AND NEW.revoke_reason <=> OLD.revoke_reason) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'a revocation cannot be changed';
  END IF;
  IF OLD.superseded_by IS NOT NULL AND NOT (NEW.superseded_by <=> OLD.superseded_by) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'supersession cannot be changed';
  END IF;
END
-- //
-- Certificates can be the subject of reminders and notifications.
ALTER TABLE reminder_log MODIFY entity_type ENUM('finding','evidence_request','certificate') NOT NULL
-- //
ALTER TABLE notifications MODIFY entity_type ENUM('finding','evidence_request','checklist_item','certificate') NOT NULL
