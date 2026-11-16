CREATE TABLE frameworks (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(190) NOT NULL,
  region VARCHAR(80) NULL,
  description TEXT NULL,
  color CHAR(7) NOT NULL DEFAULT '#812671',
  secondary_guidance_label VARCHAR(80) NULL,
  archived TINYINT(1) NOT NULL DEFAULT 0,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_fw_name (name),
  CONSTRAINT fk_fw_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
CREATE TABLE framework_releases (
  id CHAR(36) NOT NULL PRIMARY KEY,
  framework_id CHAR(36) NOT NULL,
  version INT NOT NULL,
  status ENUM('draft','published') NOT NULL DEFAULT 'draft',
  based_on_release_id CHAR(36) NULL,
  published_at DATETIME(3) NULL,
  published_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  open_draft_key CHAR(36) AS (IF(status = 'draft', framework_id, NULL)) STORED,
  UNIQUE KEY uq_rel_version (framework_id, version),
  UNIQUE KEY uq_one_open_draft (open_draft_key),
  CONSTRAINT fk_rel_fw FOREIGN KEY (framework_id) REFERENCES frameworks(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rel_base FOREIGN KEY (based_on_release_id) REFERENCES framework_releases(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rel_pub FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_rel_published CHECK ((status = 'draft' AND published_at IS NULL) OR (status = 'published' AND published_at IS NOT NULL))
) ENGINE=InnoDB;
-- //
CREATE TABLE framework_controls (
  id CHAR(36) NOT NULL PRIMARY KEY,
  release_id CHAR(36) NOT NULL,
  ref VARCHAR(60) NOT NULL,
  domain VARCHAR(190) NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT NULL,
  owner_department VARCHAR(190) NULL,
  secondary_guidance_note TEXT NULL,
  remarks TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_ctl_ref (release_id, ref),
  KEY ix_ctl_domain (release_id, domain),
  CONSTRAINT fk_ctl_rel FOREIGN KEY (release_id) REFERENCES framework_releases(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
CREATE TRIGGER rel_no_update_published BEFORE UPDATE ON framework_releases FOR EACH ROW
BEGIN IF OLD.status = 'published' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'published release is immutable'; END IF; END;
-- //
CREATE TRIGGER rel_no_delete_published BEFORE DELETE ON framework_releases FOR EACH ROW
BEGIN IF OLD.status = 'published' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'published release is immutable'; END IF; END;
-- //
CREATE TRIGGER ctl_no_insert_published BEFORE INSERT ON framework_controls FOR EACH ROW
BEGIN IF (SELECT status FROM framework_releases WHERE id = NEW.release_id) = 'published' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'published release is immutable'; END IF; END;
-- //
CREATE TRIGGER ctl_no_update_published BEFORE UPDATE ON framework_controls FOR EACH ROW
BEGIN
  IF (SELECT status FROM framework_releases WHERE id = OLD.release_id) = 'published' OR (SELECT status FROM framework_releases WHERE id = NEW.release_id) = 'published'
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'published release is immutable'; END IF;
END;
-- //
CREATE TRIGGER ctl_no_delete_published BEFORE DELETE ON framework_controls FOR EACH ROW
BEGIN IF (SELECT status FROM framework_releases WHERE id = OLD.release_id) = 'published' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'published release is immutable'; END IF; END;
-- //
CREATE TABLE common_controls (
  id CHAR(36) NOT NULL PRIMARY KEY,
  title VARCHAR(190) NOT NULL,
  description TEXT NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_cc_title (title),
  CONSTRAINT fk_cc_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
CREATE TABLE control_mappings (
  control_id CHAR(36) NOT NULL PRIMARY KEY,
  common_control_id CHAR(36) NOT NULL,
  rationale VARCHAR(1000) NULL,
  mapped_by CHAR(36) NOT NULL,
  mapped_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_map_cc (common_control_id),
  CONSTRAINT fk_map_ctl FOREIGN KEY (control_id) REFERENCES framework_controls(id) ON DELETE RESTRICT,
  CONSTRAINT fk_map_cc FOREIGN KEY (common_control_id) REFERENCES common_controls(id) ON DELETE RESTRICT,
  CONSTRAINT fk_map_by FOREIGN KEY (mapped_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
CREATE TABLE control_mapping_history (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  control_id CHAR(36) NOT NULL,
  common_control_id CHAR(36) NULL,
  previous_common_control_id CHAR(36) NULL,
  action ENUM('map','change','unmap') NOT NULL,
  rationale VARCHAR(1000) NULL,
  actor_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_mh_control (control_id, id)
) ENGINE=InnoDB;
-- //
CREATE TRIGGER mh_no_update BEFORE UPDATE ON control_mapping_history FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'control_mapping_history is append-only';
-- //
CREATE TRIGGER mh_no_delete BEFORE DELETE ON control_mapping_history FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'control_mapping_history is append-only';
