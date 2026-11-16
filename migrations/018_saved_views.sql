-- Phase 9D: saved filter views. Personal: each view belongs to one person in one organization and is never shown to anyone else.
CREATE TABLE saved_views (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  page ENUM('risks','incidents','findings') NOT NULL,
  name VARCHAR(60) NOT NULL,
  filters TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_view_name (tenant_id, user_id, page, name),
  KEY ix_view_user (user_id),
  CONSTRAINT fk_view_tenant FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_view_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_view_name CHECK (CHAR_LENGTH(TRIM(name)) > 0)
) ENGINE=InnoDB
