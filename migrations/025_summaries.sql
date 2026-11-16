-- Phase 10F: summary tables for the single-pane-of-glass screens.
-- engagement_summary holds, per engagement, the evaluated readiness summary and finding counts with the moment they were computed. The worker refreshes it
-- (within seconds of a change, and every ~10 minutes regardless). summary_dirty is the queue: database triggers mark an engagement dirty whenever anything that
-- feeds its readiness changes, whichever code path or raw statement made the change.
CREATE TABLE engagement_summary (
  tenant_id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  summary JSON NOT NULL,
  findings_unresolved INT NOT NULL DEFAULT 0,
  findings_critical INT NOT NULL DEFAULT 0,
  findings_overdue INT NOT NULL DEFAULT 0,
  computed_for DATE NOT NULL,
  computed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, engagement_id),
  KEY ix_es_computed (computed_at),
  CONSTRAINT fk_es_eng FOREIGN KEY (tenant_id, engagement_id) REFERENCES engagements(tenant_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB
-- //
CREATE TABLE summary_dirty (
  tenant_id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NOT NULL,
  marked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (tenant_id, engagement_id),
  KEY ix_sd_marked (marked_at)
) ENGINE=InnoDB
-- //
CREATE TRIGGER sd_checklist_items_ins AFTER INSERT ON checklist_items FOR EACH ROW
  INSERT INTO summary_dirty(tenant_id,engagement_id) VALUES (NEW.tenant_id, NEW.engagement_id) ON DUPLICATE KEY UPDATE marked_at=CURRENT_TIMESTAMP(3)
-- //
CREATE TRIGGER sd_checklist_items_upd AFTER UPDATE ON checklist_items FOR EACH ROW
  INSERT INTO summary_dirty(tenant_id,engagement_id) VALUES (NEW.tenant_id, NEW.engagement_id) ON DUPLICATE KEY UPDATE marked_at=CURRENT_TIMESTAMP(3)
-- //
CREATE TRIGGER sd_checklist_items_del AFTER DELETE ON checklist_items FOR EACH ROW
  INSERT INTO summary_dirty(tenant_id,engagement_id) VALUES (OLD.tenant_id, OLD.engagement_id) ON DUPLICATE KEY UPDATE marked_at=CURRENT_TIMESTAMP(3)
-- //
CREATE TRIGGER sd_evidence_requests_ins AFTER INSERT ON evidence_requests FOR EACH ROW
  INSERT INTO summary_dirty(tenant_id,engagement_id) VALUES (NEW.tenant_id, NEW.engagement_id) ON DUPLICATE KEY UPDATE marked_at=CURRENT_TIMESTAMP(3)
-- //
CREATE TRIGGER sd_evidence_requests_upd AFTER UPDATE ON evidence_requests FOR EACH ROW
  INSERT INTO summary_dirty(tenant_id,engagement_id) VALUES (NEW.tenant_id, NEW.engagement_id) ON DUPLICATE KEY UPDATE marked_at=CURRENT_TIMESTAMP(3)
-- //
CREATE TRIGGER sd_findings_ins AFTER INSERT ON findings FOR EACH ROW
  INSERT INTO summary_dirty(tenant_id,engagement_id) VALUES (NEW.tenant_id, NEW.engagement_id) ON DUPLICATE KEY UPDATE marked_at=CURRENT_TIMESTAMP(3)
-- //
CREATE TRIGGER sd_findings_upd AFTER UPDATE ON findings FOR EACH ROW
  INSERT INTO summary_dirty(tenant_id,engagement_id) VALUES (NEW.tenant_id, NEW.engagement_id) ON DUPLICATE KEY UPDATE marked_at=CURRENT_TIMESTAMP(3)
-- //
CREATE TRIGGER sd_soa_entries_ins AFTER INSERT ON soa_entries FOR EACH ROW
  INSERT INTO summary_dirty(tenant_id,engagement_id) VALUES (NEW.tenant_id, NEW.engagement_id) ON DUPLICATE KEY UPDATE marked_at=CURRENT_TIMESTAMP(3)
-- //
CREATE TRIGGER sd_soa_entries_upd AFTER UPDATE ON soa_entries FOR EACH ROW
  INSERT INTO summary_dirty(tenant_id,engagement_id) VALUES (NEW.tenant_id, NEW.engagement_id) ON DUPLICATE KEY UPDATE marked_at=CURRENT_TIMESTAMP(3)
-- //
CREATE TRIGGER sd_soa_entries_del AFTER DELETE ON soa_entries FOR EACH ROW
  INSERT INTO summary_dirty(tenant_id,engagement_id) VALUES (OLD.tenant_id, OLD.engagement_id) ON DUPLICATE KEY UPDATE marked_at=CURRENT_TIMESTAMP(3)
-- //
CREATE TRIGGER sd_checklist_item_controls_ins AFTER INSERT ON checklist_item_controls FOR EACH ROW
  INSERT INTO summary_dirty(tenant_id,engagement_id) VALUES (NEW.tenant_id, NEW.engagement_id) ON DUPLICATE KEY UPDATE marked_at=CURRENT_TIMESTAMP(3)
-- //
CREATE TRIGGER sd_checklist_item_controls_upd AFTER UPDATE ON checklist_item_controls FOR EACH ROW
  INSERT INTO summary_dirty(tenant_id,engagement_id) VALUES (NEW.tenant_id, NEW.engagement_id) ON DUPLICATE KEY UPDATE marked_at=CURRENT_TIMESTAMP(3)
-- //
CREATE TRIGGER sd_checklist_item_controls_del AFTER DELETE ON checklist_item_controls FOR EACH ROW
  INSERT INTO summary_dirty(tenant_id,engagement_id) VALUES (OLD.tenant_id, OLD.engagement_id) ON DUPLICATE KEY UPDATE marked_at=CURRENT_TIMESTAMP(3)
-- //
CREATE TRIGGER sd_engagements_ins AFTER INSERT ON engagements FOR EACH ROW
  INSERT INTO summary_dirty(tenant_id,engagement_id) VALUES (NEW.tenant_id, NEW.id) ON DUPLICATE KEY UPDATE marked_at=CURRENT_TIMESTAMP(3)
-- //
CREATE TRIGGER sd_engagements_upd AFTER UPDATE ON engagements FOR EACH ROW
  INSERT INTO summary_dirty(tenant_id,engagement_id) VALUES (NEW.tenant_id, NEW.id) ON DUPLICATE KEY UPDATE marked_at=CURRENT_TIMESTAMP(3)
