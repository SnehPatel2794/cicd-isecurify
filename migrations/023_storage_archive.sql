-- Phase 10D: evidence archival and legal hold.
-- Evidence is NEVER deleted. When an engagement has been closed for longer than its organization's retention period, the worker marks it archived
-- (read-only record, kept in full, filterable). A legal hold on the organization or the engagement stops archival.
ALTER TABLE organizations
  ADD COLUMN legal_hold TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN legal_hold_reason VARCHAR(300) NULL,
  ADD COLUMN legal_hold_at DATETIME(3) NULL
-- //
ALTER TABLE engagements
  ADD COLUMN legal_hold TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN legal_hold_reason VARCHAR(300) NULL,
  ADD COLUMN legal_hold_at DATETIME(3) NULL
-- //
-- One row per archived engagement. restored_at is set when an administrator brings it back; the worker never archives an engagement that already has a row,
-- so a restored engagement stays active until someone decides otherwise.
CREATE TABLE evidence_archive (
  tenant_id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  archived_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  retention_months INT NOT NULL,
  closed_at DATETIME(3) NOT NULL,
  request_count INT NOT NULL DEFAULT 0,
  restored_at DATETIME(3) NULL,
  restored_by CHAR(36) NULL,
  PRIMARY KEY (tenant_id, engagement_id),
  CONSTRAINT fk_ea_eng FOREIGN KEY (tenant_id, engagement_id) REFERENCES engagements(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ea_by FOREIGN KEY (restored_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB
