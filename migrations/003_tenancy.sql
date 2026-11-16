ALTER TABLE users ADD COLUMN deleted_at DATETIME(3) NULL;
-- //
CREATE TABLE organizations (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(190) NOT NULL,
  domain VARCHAR(190) NULL,
  status ENUM('active','suspended','archived') NOT NULL DEFAULT 'active',
  retention_months INT NOT NULL DEFAULT 84,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_org_name (name),
  CONSTRAINT chk_org_retention CHECK (retention_months BETWEEN 1 AND 600)
) ENGINE=InnoDB;
-- //
CREATE TABLE memberships (
  tenant_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  role ENUM('client_admin','client_staff','third_party_vendor','tp_auditor') NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, user_id),
  KEY ix_mem_user (user_id),
  CONSTRAINT fk_mem_org FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mem_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
CREATE TABLE staff_assignments (
  tenant_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  can_manage TINYINT(1) NOT NULL DEFAULT 1,
  can_read_evidence TINYINT(1) NOT NULL DEFAULT 0,
  expires_at DATETIME(3) NULL,
  granted_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, user_id),
  KEY ix_sa_user (user_id),
  CONSTRAINT fk_sa_org FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sa_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sa_grantor FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
CREATE TABLE invitations (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NULL,
  kind ENUM('tenant','platform') NOT NULL,
  email VARCHAR(190) NOT NULL,
  role VARCHAR(30) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  invited_by CHAR(36) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  accepted_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_inv_token (token_hash),
  KEY ix_inv_tenant (tenant_id, email),
  KEY ix_inv_email (email),
  CONSTRAINT fk_inv_org FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_inv_by FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
CREATE TABLE user_deletion_log (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  deleted_user_id CHAR(36) NOT NULL,
  email_snapshot VARCHAR(190) NOT NULL,
  name_snapshot VARCHAR(190) NOT NULL,
  performed_by CHAR(36) NOT NULL,
  backup_taken TINYINT(1) NOT NULL,
  reason VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_udl_user (deleted_user_id)
) ENGINE=InnoDB;
-- //
CREATE TRIGGER udl_no_update BEFORE UPDATE ON user_deletion_log FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'user_deletion_log is append-only';
-- //
CREATE TRIGGER udl_no_delete BEFORE DELETE ON user_deletion_log FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'user_deletion_log is append-only';
