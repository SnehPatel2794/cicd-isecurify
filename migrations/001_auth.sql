CREATE TABLE users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  email VARCHAR(190) NOT NULL,
  name VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NULL,
  status ENUM('active','disabled','deleted') NOT NULL DEFAULT 'active',
  platform_role ENUM('none','super_admin','admin','isecurify_team') NOT NULL DEFAULT 'none',
  failed_logins INT NOT NULL DEFAULT 0,
  locked_until DATETIME(3) NULL,
  password_changed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- //
CREATE TABLE sessions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  token_hash CHAR(64) NOT NULL,
  user_id CHAR(36) NOT NULL,
  mfa_pending TINYINT(1) NOT NULL DEFAULT 0,
  ip VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sessions_token (token_hash),
  KEY ix_sessions_user (user_id),
  KEY ix_sessions_exp (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
CREATE TABLE mfa_secrets (
  user_id CHAR(36) NOT NULL PRIMARY KEY,
  secret_enc VARCHAR(255) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  last_step BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  enabled_at DATETIME(3) NULL,
  CONSTRAINT fk_mfa_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
CREATE TABLE recovery_codes (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  used_at DATETIME(3) NULL,
  KEY ix_rc_user (user_id, code_hash),
  CONSTRAINT fk_rc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
CREATE TABLE password_resets (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_pr_token (token_hash),
  CONSTRAINT fk_pr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
CREATE TABLE audit_events (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id CHAR(36) NULL,
  actor_id CHAR(36) NULL,
  action VARCHAR(80) NOT NULL,
  entity VARCHAR(60) NULL,
  entity_id VARCHAR(64) NULL,
  detail JSON NULL,
  ip VARCHAR(45) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_audit_tenant (tenant_id, id),
  KEY ix_audit_actor (actor_id, id),
  KEY ix_audit_action (action, id)
) ENGINE=InnoDB;
-- //
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_events is append-only';
-- //
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_events is append-only';
