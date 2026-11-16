-- Phase 11B: integrations. api_keys (scoped, hashed), webhook_endpoints, webhook_deliveries (signed, retried), webhook_cursor (how far the audit log has been fanned out).
CREATE TABLE api_keys (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  prefix CHAR(8) NOT NULL,
  key_hash CHAR(64) NOT NULL,
  scopes JSON NOT NULL,
  created_by CHAR(36) NOT NULL,
  expires_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  revoked_by CHAR(36) NULL,
  last_used_at DATETIME(3) NULL,
  last_used_ip VARCHAR(45) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_key_prefix (prefix),
  KEY ix_key_tenant (tenant_id, revoked_at),
  CONSTRAINT fk_key_org FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_key_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_key_name CHECK (CHAR_LENGTH(TRIM(name)) > 0)
) ENGINE=InnoDB;
-- //
CREATE TABLE webhook_endpoints (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  url VARCHAR(500) NOT NULL,
  secret_enc TEXT NOT NULL,
  events JSON NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  disabled_reason VARCHAR(200) NULL,
  consecutive_failures INT NOT NULL DEFAULT 0,
  last_success_at DATETIME(3) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  KEY ix_wh_active (active, tenant_id),
  CONSTRAINT fk_wh_org FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_wh_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_wh_name CHECK (CHAR_LENGTH(TRIM(name)) > 0)
) ENGINE=InnoDB;
-- //
CREATE TABLE webhook_deliveries (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  endpoint_id CHAR(36) NOT NULL,
  audit_id BIGINT NULL,
  event_type VARCHAR(80) NOT NULL,
  payload JSON NOT NULL,
  status ENUM('pending','delivered','dead') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_status INT NULL,
  last_error VARCHAR(300) NULL,
  delivered_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_wd_event (endpoint_id, audit_id),
  KEY ix_wd_due (status, next_attempt_at),
  KEY ix_wd_endpoint (tenant_id, endpoint_id, id),
  CONSTRAINT fk_wd_ep FOREIGN KEY (tenant_id, endpoint_id) REFERENCES webhook_endpoints(tenant_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
CREATE TABLE webhook_cursor (
  id TINYINT NOT NULL PRIMARY KEY,
  last_audit_id BIGINT NOT NULL,
  CONSTRAINT chk_whc CHECK (id = 1)
) ENGINE=InnoDB;
-- //
INSERT INTO webhook_cursor(id, last_audit_id) SELECT 1, COALESCE(MAX(id), 0) FROM audit_events;
-- //
ALTER TABLE findings ADD COLUMN external_ref VARCHAR(120) NULL, ADD UNIQUE KEY uq_finding_ext (tenant_id, external_ref);
