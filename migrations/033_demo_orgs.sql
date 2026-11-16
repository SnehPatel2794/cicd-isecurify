-- Phase 13C: demo organizations and their permanent wipe.
-- An organization is marked demo when it is created and that can never change. Only a demo organization that is being wiped (purge_started_at set, inside the wiping transaction) lets its rows be deleted; every other row stays protected by the same triggers as before.
ALTER TABLE organizations ADD COLUMN is_demo TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN purge_started_at DATETIME(3) NULL;
-- //
CREATE TRIGGER org_demo_fixed BEFORE UPDATE ON organizations FOR EACH ROW
BEGIN
  IF NEW.is_demo <> OLD.is_demo THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'an organization is marked demo when it is created and cannot be changed'; END IF;
  IF NEW.purge_started_at IS NOT NULL AND OLD.is_demo = 0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'only a demo organization can be wiped'; END IF;
END
-- //
CREATE TRIGGER org_no_delete_real BEFORE DELETE ON organizations FOR EACH ROW
BEGIN
  IF OLD.is_demo = 0 OR OLD.purge_started_at IS NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'only a demo organization that is being wiped can be deleted'; END IF;
END
-- //
DROP TRIGGER IF EXISTS audit_no_delete
-- //
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.tenant_id AND is_demo = 1 AND purge_started_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_events is append-only'; END IF;
END
-- //
DROP TRIGGER IF EXISTS cert_no_delete
-- //
CREATE TRIGGER cert_no_delete BEFORE DELETE ON certificates FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.tenant_id AND is_demo = 1 AND purge_started_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'certificates are never deleted'; END IF;
END
-- //
DROP TRIGGER IF EXISTS rv_no_delete
-- //
CREATE TRIGGER rv_no_delete BEFORE DELETE ON evidence_reviews FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.tenant_id AND is_demo = 1 AND purge_started_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'evidence reviews are append-only'; END IF;
END
-- //
DROP TRIGGER IF EXISTS sc_no_delete
-- //
CREATE TRIGGER sc_no_delete BEFORE DELETE ON evidence_scans FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.tenant_id AND is_demo = 1 AND purge_started_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'scan results are append-only'; END IF;
END
-- //
DROP TRIGGER IF EXISTS ev_no_delete
-- //
CREATE TRIGGER ev_no_delete BEFORE DELETE ON evidence_versions FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.tenant_id AND is_demo = 1 AND purge_started_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'evidence versions are immutable'; END IF;
END
-- //
DROP TRIGGER IF EXISTS f_no_delete
-- //
CREATE TRIGGER f_no_delete BEFORE DELETE ON findings FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.tenant_id AND is_demo = 1 AND purge_started_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'findings are never deleted'; END IF;
END
-- //
DROP TRIGGER IF EXISTS fe_no_delete
-- //
CREATE TRIGGER fe_no_delete BEFORE DELETE ON finding_events FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.tenant_id AND is_demo = 1 AND purge_started_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'finding events are append-only'; END IF;
END
-- //
DROP TRIGGER IF EXISTS fev_no_delete
-- //
CREATE TRIGGER fev_no_delete BEFORE DELETE ON finding_evidence FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.tenant_id AND is_demo = 1 AND purge_started_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'finding evidence links are permanent'; END IF;
END
-- //
DROP TRIGGER IF EXISTS fi_no_delete
-- //
CREATE TRIGGER fi_no_delete BEFORE DELETE ON finding_imports FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.tenant_id AND is_demo = 1 AND purge_started_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'finding_imports is append-only'; END IF;
END
-- //
DROP TRIGGER IF EXISTS inc_no_delete
-- //
CREATE TRIGGER inc_no_delete BEFORE DELETE ON incidents FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.tenant_id AND is_demo = 1 AND purge_started_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'incidents are never deleted'; END IF;
END
-- //
DROP TRIGGER IF EXISTS ie_no_delete
-- //
CREATE TRIGGER ie_no_delete BEFORE DELETE ON incident_events FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.tenant_id AND is_demo = 1 AND purge_started_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'incident events are append-only'; END IF;
END
-- //
DROP TRIGGER IF EXISTS policy_no_delete
-- //
CREATE TRIGGER policy_no_delete BEFORE DELETE ON policies FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.tenant_id AND is_demo = 1 AND purge_started_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'policies are never deleted'; END IF;
END
-- //
DROP TRIGGER IF EXISTS ack_no_delete
-- //
CREATE TRIGGER ack_no_delete BEFORE DELETE ON policy_acks FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.tenant_id AND is_demo = 1 AND purge_started_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'acknowledgements are permanent'; END IF;
END
-- //
DROP TRIGGER IF EXISTS pe_no_delete
-- //
CREATE TRIGGER pe_no_delete BEFORE DELETE ON policy_events FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.tenant_id AND is_demo = 1 AND purge_started_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'policy events are append-only'; END IF;
END
-- //
DROP TRIGGER IF EXISTS re_no_delete
-- //
CREATE TRIGGER re_no_delete BEFORE DELETE ON report_exports FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.tenant_id AND is_demo = 1 AND purge_started_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'report_exports is append-only'; END IF;
END
-- //
DROP TRIGGER IF EXISTS risk_no_delete
-- //
CREATE TRIGGER risk_no_delete BEFORE DELETE ON risks FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.tenant_id AND is_demo = 1 AND purge_started_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'risks are never deleted'; END IF;
END
-- //
DROP TRIGGER IF EXISTS rev_no_delete
-- //
CREATE TRIGGER rev_no_delete BEFORE DELETE ON risk_events FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.tenant_id AND is_demo = 1 AND purge_started_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'risk events are append-only'; END IF;
END
-- //
DROP TRIGGER IF EXISTS vendor_no_delete
-- //
CREATE TRIGGER vendor_no_delete BEFORE DELETE ON vendors FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.tenant_id AND is_demo = 1 AND purge_started_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'vendors are never deleted'; END IF;
END
-- //
DROP TRIGGER IF EXISTS va_no_delete
-- //
CREATE TRIGGER va_no_delete BEFORE DELETE ON vendor_assessments FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.tenant_id AND is_demo = 1 AND purge_started_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'assessments are never deleted'; END IF;
END
-- //
DROP TRIGGER IF EXISTS vev_no_delete
-- //
CREATE TRIGGER vev_no_delete BEFORE DELETE ON vendor_events FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.tenant_id AND is_demo = 1 AND purge_started_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'vendor_events is append-only'; END IF;
END
-- //
DROP TRIGGER IF EXISTS eq_core_no_delete
-- //
CREATE TRIGGER eq_core_no_delete BEFORE DELETE ON engagement_questions FOR EACH ROW
BEGIN
  IF OLD.core = 1 AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.tenant_id AND is_demo = 1 AND purge_started_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'core questions are never deleted'; END IF;
END
-- //
DROP TRIGGER IF EXISTS pv_no_delete
-- //
CREATE TRIGGER pv_no_delete BEFORE DELETE ON policy_versions FOR EACH ROW
BEGIN
  IF OLD.status <> 'draft' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.tenant_id AND is_demo = 1 AND purge_started_at IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'only a draft version can be discarded'; END IF;
END
-- //
