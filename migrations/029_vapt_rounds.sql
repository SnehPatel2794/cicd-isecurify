-- Phase 11D: VAPT rounds inside an engagement (two or three a year). Findings can be tagged to the round that found them.
CREATE TABLE vapt_rounds (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  round_no INT NOT NULL,
  title VARCHAR(190) NOT NULL,
  scope TEXT NULL,
  tester VARCHAR(190) NULL,
  planned_on DATE NOT NULL,
  started_on DATE NULL,
  report_issued_on DATE NULL,
  report_title VARCHAR(300) NULL,
  report_ref VARCHAR(190) NULL,
  retest_planned_on DATE NULL,
  retested_on DATE NULL,
  status ENUM('planned','in_progress','report_issued','retesting','closed','cancelled') NOT NULL DEFAULT 'planned',
  closed_at DATETIME(3) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_vr_no (tenant_id, engagement_id, round_no),
  KEY ix_vr_due (status, planned_on),
  CONSTRAINT fk_vr_eng FOREIGN KEY (tenant_id, engagement_id) REFERENCES engagements(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_vr_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT ck_vr_no CHECK (round_no >= 1),
  CONSTRAINT ck_vr_report CHECK (status NOT IN ('report_issued','retesting','closed') OR (report_title IS NOT NULL AND report_issued_on IS NOT NULL)),
  CONSTRAINT ck_vr_closed CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
-- //
ALTER TABLE findings ADD COLUMN round_id CHAR(36) NULL, ADD CONSTRAINT fk_fnd_round FOREIGN KEY (tenant_id, round_id) REFERENCES vapt_rounds(tenant_id, id) ON DELETE RESTRICT;
-- //
CREATE TABLE vapt_notice_log (
  round_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  stage ENUM('upcoming','due','overdue') NOT NULL,
  planned_on DATE NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (round_id, user_id, stage, planned_on)
);
