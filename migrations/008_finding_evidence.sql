-- Phase 6C: remediation evidence. A finding can point to evidence requests of the SAME checklist item. Links are permanent (no update, no delete); to withdraw evidence, cancel the evidence request.
-- The "same item" rule is enforced by the database: both foreign keys include item_id, backed by extra unique keys on the two parent tables.
ALTER TABLE findings ADD UNIQUE KEY uq_f_item (tenant_id, id, item_id);
-- //
ALTER TABLE evidence_requests ADD UNIQUE KEY uq_er_item (tenant_id, id, item_id);
-- //
CREATE TABLE finding_evidence (
  tenant_id CHAR(36) NOT NULL,
  finding_id CHAR(36) NOT NULL,
  request_id CHAR(36) NOT NULL,
  item_id CHAR(36) NOT NULL,
  linked_by CHAR(36) NOT NULL,
  linked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, finding_id, request_id),
  KEY ix_fev_req (tenant_id, request_id),
  KEY ix_fev_by (linked_by),
  CONSTRAINT fk_fev_finding FOREIGN KEY (tenant_id, finding_id, item_id) REFERENCES findings(tenant_id, id, item_id) ON DELETE RESTRICT,
  CONSTRAINT fk_fev_request FOREIGN KEY (tenant_id, request_id, item_id) REFERENCES evidence_requests(tenant_id, id, item_id) ON DELETE RESTRICT,
  CONSTRAINT fk_fev_by FOREIGN KEY (linked_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
-- //
CREATE TRIGGER fev_no_update BEFORE UPDATE ON finding_evidence FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'finding evidence links are permanent';
-- //
CREATE TRIGGER fev_no_delete BEFORE DELETE ON finding_evidence FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'finding evidence links are permanent';
-- //
ALTER TABLE finding_events MODIFY kind ENUM('raised','status','edited','assigned','comment','evidence') NOT NULL;
