-- Phase 13A: core (compulsory) vs optional / industry questions, multi-choice answers, and per-engagement editing of the copy.
ALTER TABLE questionnaire_questions ADD COLUMN core TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN industries VARCHAR(300) NULL
-- //
ALTER TABLE questionnaire_questions MODIFY answer_type ENUM('yes_no','choice','multi_choice','text','number','date') NOT NULL
-- //
ALTER TABLE questionnaire_questions DROP CONSTRAINT ck_qq_choice
-- //
ALTER TABLE questionnaire_questions ADD CONSTRAINT ck_qq_choice CHECK ((answer_type IN ('choice','multi_choice')) = (choices IS NOT NULL))
-- //
ALTER TABLE engagements ADD COLUMN industry VARCHAR(60) NULL
-- //
ALTER TABLE engagement_questions MODIFY answer_type ENUM('yes_no','choice','multi_choice','text','number','date') NOT NULL, MODIFY version_id CHAR(36) NULL,
  ADD COLUMN core TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN industries VARCHAR(300) NULL, ADD COLUMN origin ENUM('library','custom') NOT NULL DEFAULT 'library',
  ADD COLUMN edited TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN removed_at DATETIME(3) NULL, ADD COLUMN removed_by CHAR(36) NULL, ADD COLUMN removed_reason VARCHAR(500) NULL
-- //
ALTER TABLE engagement_questions ADD CONSTRAINT ck_eq_core CHECK (core = 0 OR (removed_at IS NULL AND origin = 'library'))
-- //
CREATE TRIGGER eq_core_no_delete BEFORE DELETE ON engagement_questions FOR EACH ROW
BEGIN
  IF OLD.core = 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'core questions are never deleted'; END IF;
END;
-- //
CREATE TRIGGER eq_core_immutable BEFORE UPDATE ON engagement_questions FOR EACH ROW
BEGIN
  IF OLD.core = 1 AND NOT (OLD.question <=> NEW.question AND OLD.section <=> NEW.section AND OLD.answer_type <=> NEW.answer_type AND OLD.choices <=> NEW.choices AND OLD.required <=> NEW.required AND OLD.help_text <=> NEW.help_text AND OLD.core <=> NEW.core AND OLD.removed_at <=> NEW.removed_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'core questions cannot be changed or removed';
  END IF;
END;
