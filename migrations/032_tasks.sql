-- Phase 13B: tasks inside an engagement (assignee, due date, status, dependencies, comments) and reusable task templates.
CREATE TABLE task_templates (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(190) NOT NULL,
  framework_id CHAR(36) NULL,
  description VARCHAR(500) NULL,
  items LONGTEXT NOT NULL,
  item_count INT NOT NULL,
  source_name VARCHAR(255) NULL,
  sha256 CHAR(64) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  archived_at DATETIME(3) NULL,
  KEY ix_tt_fw (framework_id),
  CONSTRAINT fk_tt_fw FOREIGN KEY (framework_id) REFERENCES frameworks(id) ON DELETE RESTRICT,
  CONSTRAINT ck_tt_count CHECK (item_count >= 1)
);
-- //
CREATE TABLE tasks (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  task_no INT NOT NULL,
  ref VARCHAR(60) NULL,
  stage VARCHAR(190) NULL,
  phase TINYINT NULL,
  title VARCHAR(300) NOT NULL,
  description TEXT NULL,
  owner_hint VARCHAR(190) NULL,
  assignee_id CHAR(36) NULL,
  priority ENUM('low','normal','high') NOT NULL DEFAULT 'normal',
  status ENUM('not_started','in_progress','waiting','blocked','done','cancelled') NOT NULL DEFAULT 'not_started',
  start_date DATE NULL,
  due_date DATE NULL,
  completed_at DATETIME(3) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_tk_no (tenant_id, engagement_id, task_no),
  KEY ix_tk_assignee (tenant_id, assignee_id, status),
  KEY ix_tk_eng (tenant_id, engagement_id, status, due_date),
  KEY ix_tk_due (status, due_date),
  CONSTRAINT fk_tk_eng FOREIGN KEY (tenant_id, engagement_id) REFERENCES engagements(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_tk_assignee FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_tk_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT ck_tk_phase CHECK (phase IS NULL OR phase BETWEEN 1 AND 5),
  CONSTRAINT ck_tk_done CHECK ((status = 'done') = (completed_at IS NOT NULL)),
  CONSTRAINT ck_tk_dates CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date)
);
-- //
CREATE TABLE task_deps (
  tenant_id CHAR(36) NOT NULL,
  task_id CHAR(36) NOT NULL,
  depends_on_id CHAR(36) NOT NULL,
  PRIMARY KEY (tenant_id, task_id, depends_on_id),
  CONSTRAINT fk_td_task FOREIGN KEY (tenant_id, task_id) REFERENCES tasks(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_td_dep FOREIGN KEY (tenant_id, depends_on_id) REFERENCES tasks(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_td_self CHECK (task_id <> depends_on_id)
);
-- //
CREATE TABLE task_comments (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  task_id CHAR(36) NOT NULL,
  author_id CHAR(36) NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  KEY ix_tc_task (tenant_id, task_id, created_at),
  CONSTRAINT fk_tc_task FOREIGN KEY (tenant_id, task_id) REFERENCES tasks(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_tc_by FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE RESTRICT
);
-- //
CREATE TABLE task_notice_log (
  task_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  stage ENUM('due_soon','overdue') NOT NULL,
  due_date DATE NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (task_id, user_id, stage, due_date)
);
