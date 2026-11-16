-- Phase 10C: the transactional outbox and per-kind email choices.
-- A business change writes an outbox event in the SAME transaction; the worker turns events into emails (and, for scanner results, notifications).
-- Events are processed at most once, retried with back-off, and parked as dead after 5 failures so nothing is lost silently.
ALTER TABLE outbox_events
  ADD COLUMN attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN last_error VARCHAR(500) NULL,
  ADD COLUMN next_try_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD COLUMN dead_at DATETIME(3) NULL,
  ADD COLUMN dedupe_key VARCHAR(120) NULL,
  ADD UNIQUE KEY uq_outbox_dedupe (dedupe_key)
-- //
-- NULL = use the kind's default (important kinds email, the rest stay in the app); 0/1 = the person's own choice.
ALTER TABLE notification_prefs ADD COLUMN email_on TINYINT(1) NULL
-- //
ALTER TABLE notifications MODIFY entity_type ENUM('finding','evidence_request','checklist_item','certificate','risk','policy','incident','vendor','engagement') NOT NULL
