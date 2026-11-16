-- Phase 11C: engagement lifecycle.
--  engagement_signoffs   the third-party auditor's opinion (or, when no auditor is assigned, a staff waiver with a reason). Append-only except for withdrawal.
--  certificates          remember the opinion they were issued under
--  engagements           renewed_from: the engagement this one re-certifies
--  findings              carried_from: the earlier finding an open one was carried over from
CREATE TABLE engagement_signoffs (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  kind ENUM('auditor','waiver') NOT NULL,
  opinion ENUM('unqualified','qualified','adverse') NULL,
  note TEXT NOT NULL,
  applicable_controls INT NOT NULL,
  effective_controls INT NOT NULL,
  unresolved_findings INT NOT NULL,
  signed_by CHAR(36) NOT NULL,
  signed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  withdrawn_at DATETIME(3) NULL,
  withdrawn_by CHAR(36) NULL,
  withdraw_reason VARCHAR(1000) NULL,
  PRIMARY KEY (tenant_id, id),
  KEY ix_so_eng (tenant_id, engagement_id, signed_at),
  CONSTRAINT fk_so_eng FOREIGN KEY (tenant_id, engagement_id) REFERENCES engagements(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_so_by FOREIGN KEY (signed_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_so_wd FOREIGN KEY (withdrawn_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT ck_so_kind CHECK ((kind = 'auditor' AND opinion IS NOT NULL) OR (kind = 'waiver' AND opinion IS NULL)),
  CONSTRAINT ck_so_wd CHECK ((withdrawn_at IS NULL AND withdrawn_by IS NULL AND withdraw_reason IS NULL) OR (withdrawn_at IS NOT NULL AND withdrawn_by IS NOT NULL AND withdraw_reason IS NOT NULL))
) ENGINE=InnoDB;
-- //
ALTER TABLE certificates ADD COLUMN opinion ENUM('unqualified','qualified','adverse') NULL, ADD COLUMN signoff_id CHAR(36) NULL;
-- //
ALTER TABLE engagements ADD COLUMN renewed_from CHAR(36) NULL, ADD CONSTRAINT fk_eng_renewed FOREIGN KEY (tenant_id, renewed_from) REFERENCES engagements(tenant_id, id) ON DELETE RESTRICT;
-- //
ALTER TABLE findings ADD COLUMN carried_from CHAR(36) NULL, ADD CONSTRAINT fk_fnd_carried FOREIGN KEY (tenant_id, carried_from) REFERENCES findings(tenant_id, id) ON DELETE RESTRICT;
