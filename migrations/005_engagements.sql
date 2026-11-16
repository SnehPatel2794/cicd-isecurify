-- Lets other tables prove that a release really belongs to the framework they say it does (composite FK target).
ALTER TABLE framework_releases ADD UNIQUE KEY uq_rel_id_fw (id, framework_id);
-- //
CREATE TABLE engagements (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  name VARCHAR(190) NOT NULL,
  client_ref VARCHAR(190) NULL,
  status ENUM('active','closed') NOT NULL DEFAULT 'active',
  current_phase TINYINT NOT NULL DEFAULT 1,
  start_date DATE NULL,
  end_date DATE NULL,
  soc2_path ENUM('TYPE1_ONLY','TYPE2_ONLY','TYPE1_THEN_TYPE2') NULL,
  document_number VARCHAR(80) NULL,
  document_owner VARCHAR(190) NULL,
  classification VARCHAR(60) NULL,
  review_cycle VARCHAR(60) NULL,
  document_version VARCHAR(40) NULL,
  client_address VARCHAR(500) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  closed_at DATETIME(3) NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_eng_name (tenant_id, name),
  CONSTRAINT fk_eng_org FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_eng_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_eng_phase CHECK (current_phase BETWEEN 1 AND 5),
  CONSTRAINT chk_eng_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
) ENGINE=InnoDB;
-- //
CREATE TABLE engagement_frameworks (
  tenant_id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  framework_id CHAR(36) NOT NULL,
  release_id CHAR(36) NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  added_by CHAR(36) NOT NULL,
  added_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  primary_marker CHAR(36) AS (IF(is_primary = 1, engagement_id, NULL)) STORED,
  PRIMARY KEY (tenant_id, engagement_id, framework_id),
  UNIQUE KEY uq_ef_one_primary (tenant_id, primary_marker),
  KEY ix_ef_release (release_id),
  CONSTRAINT fk_ef_eng FOREIGN KEY (tenant_id, engagement_id) REFERENCES engagements(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ef_rel FOREIGN KEY (release_id, framework_id) REFERENCES framework_releases(id, framework_id) ON DELETE RESTRICT,
  CONSTRAINT fk_ef_by FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
CREATE TABLE engagement_members (
  tenant_id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  member_role ENUM('lead','team','auditor') NOT NULL,
  added_by CHAR(36) NOT NULL,
  added_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  lead_marker CHAR(36) AS (IF(member_role = 'lead', engagement_id, NULL)) STORED,
  PRIMARY KEY (tenant_id, engagement_id, user_id),
  UNIQUE KEY uq_em_one_lead (tenant_id, lead_marker),
  KEY ix_em_user (tenant_id, user_id),
  CONSTRAINT fk_em_eng FOREIGN KEY (tenant_id, engagement_id) REFERENCES engagements(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_em_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_em_by FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
CREATE TABLE phase_logs (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  phase TINYINT NOT NULL,
  name VARCHAR(60) NOT NULL,
  owner_user_id CHAR(36) NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  status ENUM('not_started','in_progress','complete') NOT NULL DEFAULT 'not_started',
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_phase (tenant_id, engagement_id, phase),
  CONSTRAINT fk_ph_eng FOREIGN KEY (tenant_id, engagement_id) REFERENCES engagements(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ph_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_ph_no CHECK (phase BETWEEN 1 AND 5),
  CONSTRAINT chk_ph_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
) ENGINE=InnoDB;
-- //
CREATE TABLE checklist_items (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  origin ENUM('framework','custom') NOT NULL DEFAULT 'framework',
  common_control_id CHAR(36) NULL,
  ref VARCHAR(60) NOT NULL,
  domain VARCHAR(190) NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT NULL,
  owner_department VARCHAR(190) NULL,
  secondary_guidance_note TEXT NULL,
  remarks TEXT NULL,
  readiness_status ENUM('not_started','in_progress','partially_implemented','implemented','not_applicable') NOT NULL DEFAULT 'not_started',
  na_justification TEXT NULL,
  evidence_status ENUM('not_requested','requested','in_progress','submitted','accepted','rejected') NOT NULL DEFAULT 'not_requested',
  accountable_user_id CHAR(36) NULL,
  due_date DATE NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_item_eng (tenant_id, engagement_id, id),
  KEY ix_item_order (tenant_id, engagement_id, sort_order),
  KEY ix_item_assignee (tenant_id, accountable_user_id),
  KEY ix_item_common (tenant_id, engagement_id, common_control_id),
  CONSTRAINT fk_item_eng FOREIGN KEY (tenant_id, engagement_id) REFERENCES engagements(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_cc FOREIGN KEY (common_control_id) REFERENCES common_controls(id) ON DELETE RESTRICT,
  CONSTRAINT fk_item_user FOREIGN KEY (accountable_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_item_na CHECK (readiness_status <> 'not_applicable' OR (na_justification IS NOT NULL AND CHAR_LENGTH(TRIM(na_justification)) > 0))
) ENGINE=InnoDB;
-- //
CREATE TABLE checklist_item_controls (
  tenant_id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  item_id CHAR(36) NOT NULL,
  control_id CHAR(36) NOT NULL,
  PRIMARY KEY (tenant_id, item_id, control_id),
  UNIQUE KEY uq_link_control (tenant_id, engagement_id, control_id),
  CONSTRAINT fk_link_item FOREIGN KEY (tenant_id, engagement_id, item_id) REFERENCES checklist_items(tenant_id, engagement_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_link_ctl FOREIGN KEY (control_id) REFERENCES framework_controls(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
CREATE TABLE soa_entries (
  tenant_id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  control_id CHAR(36) NOT NULL,
  applicable TINYINT(1) NOT NULL DEFAULT 1,
  justification TEXT NULL,
  updated_by CHAR(36) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, engagement_id, control_id),
  CONSTRAINT fk_soa_eng FOREIGN KEY (tenant_id, engagement_id) REFERENCES engagements(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_soa_ctl FOREIGN KEY (control_id) REFERENCES framework_controls(id) ON DELETE RESTRICT,
  CONSTRAINT fk_soa_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_soa_just CHECK (applicable = 1 OR (justification IS NOT NULL AND CHAR_LENGTH(TRIM(justification)) > 0))
) ENGINE=InnoDB;
-- //
CREATE TABLE engagement_milestones (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  phase TINYINT NOT NULL,
  sort_order INT NOT NULL,
  title VARCHAR(300) NOT NULL,
  source VARCHAR(190) NULL,
  status ENUM('pending','in_progress','complete') NOT NULL DEFAULT 'pending',
  due_date DATE NULL,
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (tenant_id, id),
  KEY ix_ms_eng (tenant_id, engagement_id, phase, sort_order),
  CONSTRAINT fk_ms_eng FOREIGN KEY (tenant_id, engagement_id) REFERENCES engagements(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_ms_phase CHECK (phase BETWEEN 1 AND 5)
) ENGINE=InnoDB;
-- //
CREATE TABLE process_templates (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(190) NOT NULL,
  framework_id CHAR(36) NULL,
  default_marker TINYINT AS (IF(framework_id IS NULL, 1, NULL)) STORED,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_pt_framework (framework_id),
  UNIQUE KEY uq_pt_default (default_marker),
  CONSTRAINT fk_pt_fw FOREIGN KEY (framework_id) REFERENCES frameworks(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pt_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
CREATE TABLE process_template_milestones (
  id CHAR(36) NOT NULL PRIMARY KEY,
  template_id CHAR(36) NOT NULL,
  phase TINYINT NOT NULL,
  sort_order INT NOT NULL,
  title VARCHAR(300) NOT NULL,
  path_filter VARCHAR(80) NULL,
  KEY ix_ptm (template_id, phase, sort_order),
  CONSTRAINT fk_ptm_t FOREIGN KEY (template_id) REFERENCES process_templates(id) ON DELETE RESTRICT,
  CONSTRAINT chk_ptm_phase CHECK (phase BETWEEN 1 AND 5)
) ENGINE=InnoDB;
-- //
CREATE TABLE discovery_questions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  framework_id CHAR(36) NULL,
  domain VARCHAR(190) NOT NULL,
  question VARCHAR(1000) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_dq_fw (framework_id, active, sort_order),
  CONSTRAINT fk_dq_fw FOREIGN KEY (framework_id) REFERENCES frameworks(id) ON DELETE RESTRICT,
  CONSTRAINT fk_dq_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
CREATE TABLE discovery_responses (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  question_id CHAR(36) NOT NULL,
  response TEXT NULL,
  notes TEXT NULL,
  responded_by CHAR(36) NOT NULL,
  responded_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_dr (tenant_id, engagement_id, question_id),
  CONSTRAINT fk_dr_eng FOREIGN KEY (tenant_id, engagement_id) REFERENCES engagements(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_dr_q FOREIGN KEY (question_id) REFERENCES discovery_questions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_dr_by FOREIGN KEY (responded_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
INSERT INTO process_templates(id, name, framework_id) VALUES (UUID(), 'Generic audit engagement', NULL);
-- //
INSERT INTO process_template_milestones(id, template_id, phase, sort_order, title)
SELECT UUID(), t.id, v.phase, v.ord, v.title FROM process_templates t JOIN (
  SELECT 1 phase, 1 ord, 'Kick-off meeting with the client' title UNION ALL SELECT 1,2,'Confirm scope and frameworks' UNION ALL SELECT 1,3,'Share the evidence checklist with the client' UNION ALL SELECT 1,4,'Assign an accountable person to every item'
  UNION ALL SELECT 2,1,'Agree audit dates with the auditor' UNION ALL SELECT 2,2,'Collect outstanding evidence' UNION ALL SELECT 2,3,'Internal readiness review by iSecurify'
  UNION ALL SELECT 3,1,'Auditor walkthrough sessions' UNION ALL SELECT 3,2,'Respond to auditor queries'
  UNION ALL SELECT 4,1,'Review auditor findings' UNION ALL SELECT 4,2,'Remediate findings' UNION ALL SELECT 4,3,'Auditor verifies remediation'
  UNION ALL SELECT 5,1,'Final report issued' UNION ALL SELECT 5,2,'Lessons learned and closure sign-off') v WHERE t.framework_id IS NULL;
-- //
INSERT INTO discovery_questions(id, framework_id, domain, question, sort_order) VALUES
 (UUID(), NULL, 'Organization', 'How many people work in the organization, and in how many locations?', 1),
 (UUID(), NULL, 'Organization', 'Which business services or products are in scope for this audit?', 2),
 (UUID(), NULL, 'Technology', 'Which cloud providers and key SaaS tools hold in-scope data?', 3),
 (UUID(), NULL, 'Technology', 'Is there a dedicated security or compliance owner? Who?', 4),
 (UUID(), NULL, 'Compliance', 'Which audits or certifications have you completed before, and when?', 5);
