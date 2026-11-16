-- Run against a COPY of production data that was loaded into STAGING, never against production (deploy/staging.sh refresh does this and refuses otherwise).
-- Removes everything that could let staging reach real people or accept real credentials. Business content (organizations, engagements, findings) is kept.
SET FOREIGN_KEY_CHECKS = 0;
-- Four tables are protected by append-only triggers. They are lifted for this scrub only and recreated, word for word, at the end.
DROP TRIGGER IF EXISTS el_no_update;
DROP TRIGGER IF EXISTS el_no_delete;
DROP TRIGGER IF EXISTS audit_no_update;
DROP TRIGGER IF EXISTS udl_no_update;
-- every person becomes anonymous; nobody can sign in until an administrator is recovered (staging.sh prints a one-time link)
UPDATE users SET email = CONCAT('user-', SUBSTRING(id, 1, 8), '@staging.invalid'), name = CONCAT('User ', SUBSTRING(id, 1, 6)), password_hash = '!scrubbed', failed_logins = 0, locked_until = NULL;
DELETE FROM sessions;
DELETE FROM mfa_secrets;
DELETE FROM recovery_codes;
DELETE FROM password_resets;
DELETE FROM invitations;
UPDATE user_deletion_log SET email_snapshot = '[scrubbed]';
UPDATE vendors SET contact_email = CONCAT('vendor-', SUBSTRING(id, 1, 8), '@staging.invalid') WHERE contact_email IS NOT NULL;
-- nothing queued or logged may be delivered or shown
DELETE FROM jobs;
DELETE FROM outbox_events;
DELETE FROM email_log;
-- integrations: keys revoked, webhooks switched off and pointed nowhere
UPDATE api_keys SET revoked_at = COALESCE(revoked_at, NOW(3)), key_hash = SHA2(UUID(), 256), last_used_ip = NULL;
DELETE FROM webhook_deliveries;
UPDATE webhook_endpoints SET active = 0, disabled_reason = 'staging copy', url = 'https://staging.invalid/webhook', secret_enc = 'scrubbed';
-- network addresses
UPDATE audit_events SET ip = NULL;
CREATE TRIGGER el_no_update BEFORE UPDATE ON email_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'email log is append-only';
CREATE TRIGGER el_no_delete BEFORE DELETE ON email_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'email log is append-only';
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_events is append-only';
CREATE TRIGGER udl_no_update BEFORE UPDATE ON user_deletion_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'user_deletion_log is append-only';
SET FOREIGN_KEY_CHECKS = 1;
