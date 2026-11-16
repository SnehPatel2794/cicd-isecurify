-- Phase 5: evidence. Requests live on checklist items; every upload is an immutable, hashed VERSION; every auditor decision is an append-only REVIEW.
-- Nothing here is ever deleted. Portable MySQL 8 SQL: no generated columns, composite (tenant_id, ...) keys everywhere, rules enforced by CHECKs and triggers.

-- Storage accounting and the optional per-organization quota override (NULL quota = platform default from EVIDENCE_DEFAULT_QUOTA_MB).
CREATE TABLE evidence_usage (
  tenant_id CHAR(36) NOT NULL,
  used_bytes BIGINT NOT NULL DEFAULT 0,
  version_count INT NOT NULL DEFAULT 0,
  quota_bytes BIGINT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id),
  CONSTRAINT fk_eu_org FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  CONSTRAINT chk_eu_nonneg CHECK (used_bytes >= 0 AND version_count >= 0 AND (quota_bytes IS NULL OR quota_bytes >= 0))
) ENGINE=InnoDB;
-- //
-- Template library (global content, not tenant data). Files are immutable; "replace" = upload a new row that supersedes the old one.
CREATE TABLE evidence_templates (
  id CHAR(36) NOT NULL,
  name VARCHAR(190) NOT NULL,
  description TEXT NULL,
  category VARCHAR(80) NULL,
  framework_id CHAR(36) NULL,
  version_label VARCHAR(40) NULL,
  file_name VARCHAR(255) NOT NULL,
  media_type VARCHAR(120) NOT NULL,
  size_bytes BIGINT NOT NULL,
  sha256 CHAR(64) NOT NULL,
  storage_key VARCHAR(200) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  replaces_id CHAR(36) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  retired_by CHAR(36) NULL,
  retired_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY ix_et_list (active, category, name),
  CONSTRAINT fk_et_fw FOREIGN KEY (framework_id) REFERENCES frameworks(id) ON DELETE RESTRICT,
  CONSTRAINT fk_et_replaces FOREIGN KEY (replaces_id) REFERENCES evidence_templates(id) ON DELETE RESTRICT,
  CONSTRAINT fk_et_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_et_retired_by FOREIGN KEY (retired_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_et_size CHECK (size_bytes > 0)
) ENGINE=InnoDB;
-- //
CREATE TRIGGER et_no_delete BEFORE DELETE ON evidence_templates FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'templates are never deleted';
-- //
-- Only "active/retired_*" may change; the file facts of a template are permanent.
CREATE TRIGGER et_file_immutable BEFORE UPDATE ON evidence_templates FOR EACH ROW
BEGIN
  IF NOT (OLD.file_name <=> NEW.file_name AND OLD.sha256 <=> NEW.sha256 AND OLD.storage_key <=> NEW.storage_key AND OLD.size_bytes <=> NEW.size_bytes AND OLD.media_type <=> NEW.media_type) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'template files are immutable';
  END IF;
END;
-- //
CREATE TABLE evidence_requests (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  item_id CHAR(36) NOT NULL,
  title VARCHAR(300) NOT NULL,
  instructions TEXT NULL,
  template_id CHAR(36) NULL,
  due_date DATE NULL,
  valid_months SMALLINT NULL,
  status ENUM('requested','submitted','accepted','rejected','cancelled') NOT NULL DEFAULT 'requested',
  latest_version_no INT NOT NULL DEFAULT 0,
  valid_until DATE NULL,
  cancel_reason TEXT NULL,
  requested_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  KEY ix_er_eng (tenant_id, engagement_id, status),
  KEY ix_er_item (tenant_id, item_id, status),
  KEY ix_er_expiry (tenant_id, status, valid_until),
  KEY ix_er_template (template_id),
  CONSTRAINT fk_er_item FOREIGN KEY (tenant_id, engagement_id, item_id) REFERENCES checklist_items(tenant_id, engagement_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_er_tpl FOREIGN KEY (template_id) REFERENCES evidence_templates(id) ON DELETE RESTRICT,
  CONSTRAINT fk_er_by FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_er_months CHECK (valid_months IS NULL OR valid_months BETWEEN 1 AND 120),
  CONSTRAINT chk_er_cancel CHECK (status <> 'cancelled' OR (cancel_reason IS NOT NULL AND CHAR_LENGTH(TRIM(cancel_reason)) > 0)),
  CONSTRAINT chk_er_version CHECK (status IN ('requested','cancelled') OR latest_version_no > 0),
  CONSTRAINT chk_er_validity CHECK (valid_until IS NULL OR status = 'accepted')
) ENGINE=InnoDB;
-- //
-- One row per upload. File evidence carries a SHA-256 of the exact bytes; link evidence cannot (the target can change) and is marked as such.
CREATE TABLE evidence_versions (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  request_id CHAR(36) NOT NULL,
  version_no INT NOT NULL,
  kind ENUM('file','link') NOT NULL,
  file_name VARCHAR(255) NULL,
  media_type VARCHAR(120) NULL,
  size_bytes BIGINT NULL,
  sha256 CHAR(64) NULL,
  storage_key VARCHAR(200) NULL,
  link_url VARCHAR(2000) NULL,
  link_provider VARCHAR(30) NULL,
  note TEXT NULL,
  uploaded_by CHAR(36) NOT NULL,
  uploaded_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_ev_no (tenant_id, request_id, version_no),
  UNIQUE KEY uq_ev_req (tenant_id, request_id, id),
  KEY ix_ev_user (uploaded_by),
  CONSTRAINT fk_ev_req FOREIGN KEY (tenant_id, request_id) REFERENCES evidence_requests(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ev_by FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_ev_no CHECK (version_no >= 1),
  CONSTRAINT chk_ev_kind CHECK (
    (kind = 'file' AND file_name IS NOT NULL AND size_bytes IS NOT NULL AND size_bytes > 0 AND sha256 IS NOT NULL AND CHAR_LENGTH(sha256) = 64 AND storage_key IS NOT NULL AND link_url IS NULL)
    OR (kind = 'link' AND link_url IS NOT NULL AND CHAR_LENGTH(link_url) > 0 AND storage_key IS NULL AND sha256 IS NULL AND size_bytes IS NULL AND file_name IS NULL))
) ENGINE=InnoDB;
-- //
CREATE TRIGGER ev_no_update BEFORE UPDATE ON evidence_versions FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'evidence versions are immutable';
-- //
CREATE TRIGGER ev_no_delete BEFORE DELETE ON evidence_versions FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'evidence versions are immutable';
-- //
-- Auditor decisions. A decision may be changed only by adding a NEWER decision; the history is permanent. The note is mandatory.
CREATE TABLE evidence_reviews (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  request_id CHAR(36) NOT NULL,
  version_id CHAR(36) NOT NULL,
  decision ENUM('accepted','rejected') NOT NULL,
  note TEXT NOT NULL,
  valid_until DATE NULL,
  reviewed_by CHAR(36) NOT NULL,
  reviewed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  KEY ix_rv_req (tenant_id, request_id, reviewed_at),
  KEY ix_rv_user (reviewed_by),
  CONSTRAINT fk_rv_ver FOREIGN KEY (tenant_id, request_id, version_id) REFERENCES evidence_versions(tenant_id, request_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_rv_by FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_rv_note CHECK (CHAR_LENGTH(TRIM(note)) > 0),
  CONSTRAINT chk_rv_valid CHECK (decision = 'accepted' OR valid_until IS NULL)
) ENGINE=InnoDB;
-- //
CREATE TRIGGER rv_no_update BEFORE UPDATE ON evidence_reviews FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'evidence reviews are append-only';
-- //
CREATE TRIGGER rv_no_delete BEFORE DELETE ON evidence_reviews FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'evidence reviews are append-only';
-- //
-- Malware-scan results. Written by the worker (INSERT only); the newest row per version is the current result.
CREATE TABLE evidence_scans (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  version_id CHAR(36) NOT NULL,
  status ENUM('clean','infected','error') NOT NULL,
  signature VARCHAR(190) NULL,
  engine VARCHAR(80) NULL,
  detail VARCHAR(500) NULL,
  requested_by CHAR(36) NULL,
  scanned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  KEY ix_sc_ver (tenant_id, version_id, scanned_at),
  CONSTRAINT fk_sc_ver FOREIGN KEY (tenant_id, version_id) REFERENCES evidence_versions(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_sc_by FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
CREATE TRIGGER sc_no_update BEFORE UPDATE ON evidence_scans FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'scan results are append-only';
-- //
CREATE TRIGGER sc_no_delete BEFORE DELETE ON evidence_scans FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'scan results are append-only';
