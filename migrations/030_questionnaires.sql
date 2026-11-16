-- Phase 11E: engagement questionnaires. A standard question set per framework (uploaded as Excel/CSV, versioned), copied unchanged into each engagement when it starts,
-- answered by the client and reviewed by iSecurify staff.
CREATE TABLE questionnaire_versions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  framework_id CHAR(36) NOT NULL,
  version_no INT NOT NULL,
  title VARCHAR(190) NOT NULL,
  source_name VARCHAR(255) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  status ENUM('draft','published','retired') NOT NULL DEFAULT 'draft',
  question_count INT NOT NULL DEFAULT 0,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  published_by CHAR(36) NULL,
  published_at DATETIME(3) NULL,
  draft_marker CHAR(36) AS (IF(status = 'draft', framework_id, NULL)) STORED,
  UNIQUE KEY uq_qv_no (framework_id, version_no),
  UNIQUE KEY uq_qv_draft (draft_marker),
  KEY ix_qv_pub (framework_id, status, published_at),
  CONSTRAINT fk_qv_fw FOREIGN KEY (framework_id) REFERENCES frameworks(id) ON DELETE RESTRICT,
  CONSTRAINT fk_qv_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT ck_qv_pub CHECK ((status = 'draft') OR (published_at IS NOT NULL))
) ENGINE=InnoDB;
-- //
CREATE TABLE questionnaire_questions (
  id CHAR(36) NOT NULL PRIMARY KEY,
  version_id CHAR(36) NOT NULL,
  ref VARCHAR(60) NOT NULL,
  section VARCHAR(190) NOT NULL,
  question VARCHAR(1000) NOT NULL,
  answer_type ENUM('yes_no','choice','text','number','date') NOT NULL,
  choices TEXT NULL,
  required TINYINT(1) NOT NULL DEFAULT 1,
  help_text VARCHAR(1000) NULL,
  sort_order INT NOT NULL,
  UNIQUE KEY uq_qq_ref (version_id, ref),
  KEY ix_qq_ord (version_id, sort_order),
  CONSTRAINT fk_qq_v FOREIGN KEY (version_id) REFERENCES questionnaire_versions(id) ON DELETE CASCADE,
  CONSTRAINT ck_qq_choice CHECK ((answer_type = 'choice') = (choices IS NOT NULL))
) ENGINE=InnoDB;
-- //
CREATE TABLE engagement_questions (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  framework_id CHAR(36) NOT NULL,
  version_id CHAR(36) NOT NULL,
  ref VARCHAR(60) NOT NULL,
  section VARCHAR(190) NOT NULL,
  question VARCHAR(1000) NOT NULL,
  answer_type ENUM('yes_no','choice','text','number','date') NOT NULL,
  choices TEXT NULL,
  required TINYINT(1) NOT NULL,
  help_text VARCHAR(1000) NULL,
  sort_order INT NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_eq_ref (tenant_id, engagement_id, framework_id, ref),
  KEY ix_eq_eng (tenant_id, engagement_id, sort_order),
  CONSTRAINT fk_eq_eng FOREIGN KEY (tenant_id, engagement_id) REFERENCES engagements(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_eq_v FOREIGN KEY (version_id) REFERENCES questionnaire_versions(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
CREATE TABLE engagement_answers (
  tenant_id CHAR(36) NOT NULL,
  id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  question_id CHAR(36) NOT NULL,
  answer TEXT NOT NULL,
  note TEXT NULL,
  answered_by CHAR(36) NOT NULL,
  answered_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  review_status ENUM('pending','accepted','needs_change') NOT NULL DEFAULT 'pending',
  review_note TEXT NULL,
  reviewed_by CHAR(36) NULL,
  reviewed_at DATETIME(3) NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE KEY uq_ea_q (tenant_id, question_id),
  KEY ix_ea_eng (tenant_id, engagement_id, review_status),
  CONSTRAINT fk_qans_q FOREIGN KEY (tenant_id, question_id) REFERENCES engagement_questions(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_qans_by FOREIGN KEY (answered_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT ck_ea_review CHECK ((review_status = 'pending') = (reviewed_by IS NULL))
) ENGINE=InnoDB;
