-- Phase 7B: in-app notifications. One row per person per thing that happened ("F-003 was assigned to you").
-- A notification holds only a short label and the ids of what it is about; it is shown only while the person still has access to that
-- organization, and following it goes through the normal authorised screens (so losing access to the item means a 404, never a leak).
-- Only read_at ever changes. Rows are removed by the worker's cleanup (read: 90 days, any: 180 days) or when the account is deleted.
CREATE TABLE notifications (
  id BIGINT NOT NULL AUTO_INCREMENT,
  tenant_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  kind VARCHAR(40) NOT NULL,
  entity_type ENUM('finding','evidence_request','checklist_item') NOT NULL,
  entity_id CHAR(36) NOT NULL,
  engagement_id CHAR(36) NULL,
  label VARCHAR(240) NOT NULL,
  actor_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  read_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY ix_n_user (user_id, read_at, id),
  KEY ix_n_user_tenant (user_id, tenant_id, id),
  KEY ix_n_created (created_at),
  CONSTRAINT fk_n_org FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE RESTRICT,
  CONSTRAINT fk_n_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_n_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
-- //
CREATE TRIGGER n_identity_immutable BEFORE UPDATE ON notifications FOR EACH ROW
BEGIN
  IF NOT (NEW.tenant_id <=> OLD.tenant_id AND NEW.user_id <=> OLD.user_id AND NEW.kind <=> OLD.kind AND NEW.entity_type <=> OLD.entity_type AND NEW.entity_id <=> OLD.entity_id AND NEW.label <=> OLD.label AND NEW.created_at <=> OLD.created_at AND NEW.engagement_id <=> OLD.engagement_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'notifications: only read_at can change';
  END IF;
END
-- //
-- Per-person choice of which kinds appear in the app. A missing row means "on" (every kind defaults to on).
CREATE TABLE notification_prefs (
  user_id CHAR(36) NOT NULL,
  kind VARCHAR(40) NOT NULL,
  in_app TINYINT(1) NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, kind),
  CONSTRAINT fk_np_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
