-- Phase 11A: continuous controls.
--  control_tests / control_test_runs  recurring tests of a control, with an append-only history of results
--  evidence_schedules                 "this evidence must be refreshed every N months": the worker reminds, a person opens the request
--  posture_snapshots                  one row per engagement, framework and day: the compliance-posture score over time
--  continuous_notice_log              memory for the worker so each reminder is sent once

CREATE TABLE control_tests (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  item_id CHAR(36) NOT NULL,
  title VARCHAR(300) NOT NULL,
  procedure_text TEXT NULL,
  frequency ENUM('weekly','monthly','quarterly','semiannual','annual') NOT NULL,
  owner_user_id CHAR(36) NULL,
  next_due_on DATE NOT NULL,
  status ENUM('active','paused') NOT NULL DEFAULT 'active',
  last_result ENUM('pass','fail') NULL,
  last_run_on DATE NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  KEY ix_ct_due (tenant_id, status, next_due_on),
  KEY ix_ct_item (tenant_id, item_id),
  KEY ix_ct_eng (tenant_id, engagement_id),
  CONSTRAINT fk_ct_item FOREIGN KEY (tenant_id, engagement_id, item_id) REFERENCES checklist_items(tenant_id, engagement_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ct_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ct_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_ct_title CHECK (CHAR_LENGTH(TRIM(title)) > 0),
  CONSTRAINT chk_ct_last CHECK ((last_result IS NULL) = (last_run_on IS NULL))
) ENGINE=InnoDB;
-- //
CREATE TABLE control_test_runs (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  test_id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  item_id CHAR(36) NOT NULL,
  performed_on DATE NOT NULL,
  result ENUM('pass','fail') NOT NULL,
  note TEXT NOT NULL,
  performed_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  KEY ix_ctr_test (tenant_id, test_id, performed_on),
  KEY ix_ctr_eng (tenant_id, engagement_id, performed_on),
  CONSTRAINT fk_ctr_test FOREIGN KEY (tenant_id, test_id) REFERENCES control_tests(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ctr_by FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_ctr_note CHECK (CHAR_LENGTH(TRIM(note)) > 0)
) ENGINE=InnoDB;
-- //
CREATE TABLE evidence_schedules (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  item_id CHAR(36) NOT NULL,
  title VARCHAR(300) NOT NULL,
  instructions TEXT NULL,
  template_id CHAR(36) NULL,
  valid_months SMALLINT NULL,
  every_months SMALLINT NOT NULL,
  due_days SMALLINT NOT NULL DEFAULT 14,
  next_run_on DATE NOT NULL,
  status ENUM('active','paused') NOT NULL DEFAULT 'active',
  last_opened_on DATE NULL,
  last_request_id CHAR(36) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  KEY ix_es_due (tenant_id, status, next_run_on),
  KEY ix_es_item (tenant_id, item_id),
  KEY ix_es_eng (tenant_id, engagement_id),
  CONSTRAINT fk_es_item FOREIGN KEY (tenant_id, engagement_id, item_id) REFERENCES checklist_items(tenant_id, engagement_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_es_tpl FOREIGN KEY (template_id) REFERENCES evidence_templates(id) ON DELETE RESTRICT,
  CONSTRAINT fk_es_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_es_title CHECK (CHAR_LENGTH(TRIM(title)) > 0),
  CONSTRAINT chk_es_every CHECK (every_months BETWEEN 1 AND 36),
  CONSTRAINT chk_es_days CHECK (due_days BETWEEN 1 AND 90),
  CONSTRAINT chk_es_valid CHECK (valid_months IS NULL OR valid_months BETWEEN 1 AND 120)
) ENGINE=InnoDB;
-- //
CREATE TABLE posture_snapshots (
  tenant_id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  framework_id CHAR(36) NOT NULL,
  snap_date DATE NOT NULL,
  applicable INT NOT NULL,
  effective INT NOT NULL,
  awaiting_review INT NOT NULL,
  overdue INT NOT NULL,
  percent DECIMAL(5,2) NOT NULL,
  tests_total INT NOT NULL DEFAULT 0,
  tests_overdue INT NOT NULL DEFAULT 0,
  tests_failing INT NOT NULL DEFAULT 0,
  computed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, engagement_id, framework_id, snap_date),
  KEY ix_ps_date (tenant_id, snap_date),
  CONSTRAINT fk_ps_eng FOREIGN KEY (tenant_id, engagement_id) REFERENCES engagements(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_ps_pct CHECK (percent BETWEEN 0 AND 100)
) ENGINE=InnoDB;
-- //
CREATE TABLE continuous_notice_log (
  entity_type ENUM('control_test','evidence_schedule') NOT NULL,
  entity_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  stage ENUM('due','overdue') NOT NULL,
  due_on DATE NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (entity_type, entity_id, user_id, stage, due_on),
  KEY ix_cnl_created (created_at),
  CONSTRAINT fk_cnl_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
