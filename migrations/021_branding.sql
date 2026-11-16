-- Phase 10B: branding (white label). ONE row (id = 1) for the whole installation; the logo is kept in the database so every backup carries it.
CREATE TABLE branding_profile (
  id TINYINT NOT NULL,
  company_name VARCHAR(120) NOT NULL,
  primary_color CHAR(7) NOT NULL,
  secondary_color CHAR(7) NOT NULL,
  accent_color CHAR(7) NOT NULL,
  footer_text VARCHAR(300) NOT NULL DEFAULT '',
  logo_data MEDIUMBLOB NULL,
  logo_mime VARCHAR(20) NULL,
  logo_sha256 CHAR(64) NULL,
  logo_size INT NULL,
  logo_width SMALLINT NULL,
  logo_height SMALLINT NULL,
  version INT NOT NULL DEFAULT 1,
  updated_by CHAR(36) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_branding_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_branding_one CHECK (id = 1),
  CONSTRAINT chk_branding_name CHECK (CHAR_LENGTH(TRIM(company_name)) > 0),
  CONSTRAINT chk_branding_colors CHECK (primary_color REGEXP '^#[0-9a-f]{6}$' AND secondary_color REGEXP '^#[0-9a-f]{6}$' AND accent_color REGEXP '^#[0-9a-f]{6}$'),
  CONSTRAINT chk_branding_logo CHECK ((logo_data IS NULL) = (logo_mime IS NULL) AND (logo_data IS NULL) = (logo_sha256 IS NULL) AND (logo_data IS NULL) = (logo_size IS NULL)),
  CONSTRAINT chk_branding_logo_size CHECK (logo_size IS NULL OR logo_size BETWEEN 1 AND 2097152)
) ENGINE=InnoDB
-- //
INSERT INTO branding_profile (id, company_name, primary_color, secondary_color, accent_color, footer_text) VALUES (1, 'iSecurify GRC', '#812671', '#2b2a29', '#1b887d', '')
-- //
CREATE TRIGGER branding_no_delete BEFORE DELETE ON branding_profile FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'the branding profile cannot be deleted'
