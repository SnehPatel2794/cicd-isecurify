import type { Pool } from './db';
const ident = (s: string) => '`' + s.replace(/`/g, '') + '`';
// Least-privilege accounts. MySQL cannot subtract a table privilege from a schema-wide grant, so grants are per table.
// Re-run after every migration (db:setup does this).
export async function applyGrants(admin: Pool, db: string, appUser: string, appPw: string, workerUser: string, workerPw: string, host = '%', purge?: { user: string; pw: string }) {
  const [rows] = await admin.query('SELECT table_name t FROM information_schema.tables WHERE table_schema=? AND table_type=\'BASE TABLE\'', [db]) as any;
  const tables: string[] = rows.map((r: any) => r.t ?? r.T ?? r.TABLE_NAME);
  for (const [u, pw] of [[appUser, appPw], [workerUser, workerPw]]) {
    await admin.query(`CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?`, [u, host, pw]);
    await admin.query(`ALTER USER ?@? IDENTIFIED BY ?`, [u, host, pw]);
    await admin.query(`REVOKE ALL PRIVILEGES, GRANT OPTION FROM ?@?`, [u, host]);
  }
  const workerDml = new Set(['jobs', 'outbox_events', 'sessions', 'password_resets']);
  for (const t of tables) {
    const T = `${ident(db)}.${ident(t)}`;
    if (t === 'schema_migrations') { await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [appUser, host]); continue; }
    if (t === 'audit_events' || t === 'user_deletion_log' || t === 'control_mapping_history' || t === 'evidence_scans') { for (const u of [appUser, workerUser]) await admin.query(`GRANT SELECT, INSERT ON ${T} TO ?@?`, [u, host]); continue; }
    if (t === 'evidence_versions' || t === 'evidence_reviews') { await admin.query(`GRANT SELECT, INSERT ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // insert-only; the worker only reads
    if (t === 'email_log') { await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT, INSERT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // the worker writes it, the API only reads it; append-only
    if (t === 'notifications') { await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT, INSERT, DELETE ON ${T} TO ?@?`, [workerUser, host]); continue; }   // the app adds, marks read and purges a deleted account's rows; the worker cleans up old ones
    if (t === 'reminder_log') { await admin.query(`GRANT SELECT, DELETE ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT, INSERT, DELETE ON ${T} TO ?@?`, [workerUser, host]); continue; }   // the worker's daily scan is its only writer
    if (t === 'user_digest') { await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT, INSERT, UPDATE ON ${T} TO ?@?`, [workerUser, host]); continue; }   // people choose the frequency; the worker records when it last sent
    if (t === 'report_exports') { await admin.query(`GRANT SELECT, INSERT ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // append-only
    if (t === 'mapping_change_requests') { await admin.query(`GRANT SELECT, INSERT, UPDATE ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // never deleted
    if (t === 'evidence_archive') { await admin.query(`GRANT SELECT, INSERT, UPDATE ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT, INSERT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // never deleted; the worker archives, an administrator restores
    if (t === 'engagement_summary' || t === 'summary_dirty') { await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${T} TO ?@?`, [workerUser, host]); continue; }   // a derived cache: the worker refreshes it, the API may compute-and-store when it is missing
    if (t === 'control_tests') { await admin.query(`GRANT SELECT, INSERT, UPDATE ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // never deleted (pause instead)
    if (t === 'control_test_runs') { await admin.query(`GRANT SELECT, INSERT ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // append-only
    if (t === 'posture_snapshots') { await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT, INSERT, UPDATE ON ${T} TO ?@?`, [workerUser, host]); continue; }   // written only by the worker's daily snapshot
    if (t === 'continuous_notice_log') { await admin.query(`GRANT SELECT, DELETE ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT, INSERT, DELETE ON ${T} TO ?@?`, [workerUser, host]); continue; }   // the worker's daily scan is its only writer
    if (t === 'vapt_rounds') { await admin.query(`GRANT SELECT, INSERT, UPDATE ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // rounds are cancelled, never deleted
    if (t === 'engagement_questions') { await admin.query(`GRANT SELECT, INSERT, UPDATE ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // a copy: core questions are locked by a trigger, others may be edited or removed (soft) by staff
    if (t === 'engagement_answers') { await admin.query(`GRANT SELECT, INSERT, UPDATE ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // never deleted
    if (t === 'tasks') { await admin.query(`GRANT SELECT, INSERT, UPDATE ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // cancelled, never deleted
    if (t === 'task_comments') { await admin.query(`GRANT SELECT, INSERT ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // append-only
    if (t === 'task_templates') { await admin.query(`GRANT SELECT, INSERT, UPDATE ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // archived, never deleted
    if (t === 'task_notice_log') { await admin.query(`GRANT SELECT, DELETE ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT, INSERT, DELETE ON ${T} TO ?@?`, [workerUser, host]); continue; }
    if (t === 'vapt_notice_log') { await admin.query(`GRANT SELECT, DELETE ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT, INSERT, DELETE ON ${T} TO ?@?`, [workerUser, host]); continue; }
    if (t === 'engagement_signoffs') { await admin.query(`GRANT SELECT, INSERT, UPDATE ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // never deleted; only withdrawal updates a row
    if (t === 'api_keys') { await admin.query(`GRANT SELECT, INSERT, UPDATE ON ${T} TO ?@?`, [appUser, host]); continue; }   // never deleted (revoke instead); the worker has no business here
    if (t === 'webhook_endpoints') { await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT, UPDATE ON ${T} TO ?@?`, [workerUser, host]); continue; }   // the worker reads secrets and records health
    if (t === 'webhook_deliveries') { await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${T} TO ?@?`, [workerUser, host]); continue; }
    if (t === 'webhook_cursor') { await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT, UPDATE ON ${T} TO ?@?`, [workerUser, host]); continue; }
    if (t === 'backup_log') { await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // written only by the backup scripts (root)
    if (t === 'policies' || t === 'incidents') { await admin.query(`GRANT SELECT, INSERT, UPDATE ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // never deleted
    if (t === 'policy_acks' || t === 'policy_events' || t === 'incident_events') { await admin.query(`GRANT SELECT, INSERT ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // append-only
    if (t === 'risks') { await admin.query(`GRANT SELECT, INSERT, UPDATE ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // never deleted
    if (t === 'vendors' || t === 'vendor_assessments') { await admin.query(`GRANT SELECT, INSERT, UPDATE ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // never deleted
    if (t === 'vendor_events') { await admin.query(`GRANT SELECT, INSERT ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // append-only
    if (t === 'risk_events') { await admin.query(`GRANT SELECT, INSERT ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // append-only
    if (t === 'finding_imports') { await admin.query(`GRANT SELECT, INSERT ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // append-only
    if (t === 'certificates') { await admin.query(`GRANT SELECT, INSERT, UPDATE ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // never deleted
    if (t === 'findings') { await admin.query(`GRANT SELECT, INSERT, UPDATE ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // never deleted
    if (t === 'finding_events' || t === 'finding_evidence') { await admin.query(`GRANT SELECT, INSERT ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // append-only
    if (t === 'evidence_templates') { await admin.query(`GRANT SELECT, INSERT, UPDATE ON ${T} TO ?@?`, [appUser, host]); await admin.query(`GRANT SELECT ON ${T} TO ?@?`, [workerUser, host]); continue; }   // never deleted
    await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${T} TO ?@?`, [appUser, host]);
    await admin.query(workerDml.has(t) ? `GRANT SELECT, INSERT, UPDATE, DELETE ON ${T} TO ?@?` : `GRANT SELECT ON ${T} TO ?@?`, [workerUser, host]);
  }
  if (purge) await applyPurgeGrants(admin, db, purge.user, purge.pw, host, tables);
  try { await admin.query('FLUSH PRIVILEGES'); } catch { /* the migrator account has no RELOAD privilege; GRANT statements take effect immediately anyway */ }
}

/** The deploy-time account. It can change THIS database's structure and hand out its table privileges, and nothing else: no other schema, no server-wide
 *  administration (no SUPER, FILE, PROCESS, SHUTDOWN), no `mysql` system tables. CREATE USER is the one global right, needed to create the app and worker accounts.
 *  Created once by root (the `bootstrap` step); after that migrations and grants run as this account and root is not used at deploy time. */
export async function applyMigratorGrants(admin: Pool, db: string, user: string, pw: string, host = '%') {
  await admin.query(`CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?`, [user, host, pw]); await admin.query(`ALTER USER ?@? IDENTIFIED BY ?`, [user, host, pw]);
  await admin.query(`REVOKE ALL PRIVILEGES, GRANT OPTION FROM ?@?`, [user, host]);
  await admin.query(`GRANT ALL PRIVILEGES ON ${ident(db)}.* TO ?@? WITH GRANT OPTION`, [user, host]); await admin.query(`GRANT CREATE USER ON *.* TO ?@?`, [user, host]);
  try { await admin.query('FLUSH PRIVILEGES'); } catch { /* not needed */ }
}

/** Phase 13C: the account used only to wipe a demo organization. It can read and delete tenant rows and the per-person rows of people who belonged only to that organization; it cannot add or change anything
 *  except the audit record of the wipe. The append-only and never-deleted triggers still refuse every delete unless the organization is a demo one that is being wiped (migration 033). */
export async function applyPurgeGrants(admin: Pool, db: string, user: string, pw: string, host: string, tables: string[]) {
  await admin.query(`CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?`, [user, host, pw]); await admin.query(`ALTER USER ?@? IDENTIFIED BY ?`, [user, host, pw]); await admin.query(`REVOKE ALL PRIVILEGES, GRANT OPTION FROM ?@?`, [user, host]);
  const [tc] = await admin.query("SELECT DISTINCT table_name t FROM information_schema.columns WHERE table_schema=? AND column_name='tenant_id'", [db]) as any; const tenant = new Set<string>(tc.map((r: any) => r.t ?? r.T ?? r.TABLE_NAME));
  const people = new Set(['users', 'sessions', 'mfa_secrets', 'recovery_codes', 'password_resets', 'notification_prefs', 'user_digest', 'reminder_log', 'continuous_notice_log', 'task_notice_log', 'vapt_notice_log']);
  for (const t of tables) { const T = `${ident(db)}.${ident(t)}`;
    if (t === 'audit_events') { await admin.query(`GRANT SELECT, INSERT, DELETE ON ${T} TO ?@?`, [user, host]); continue; }
    if (t === 'organizations') { await admin.query(`GRANT SELECT, UPDATE, DELETE ON ${T} TO ?@?`, [user, host]); continue; }
    if (tenant.has(t) || people.has(t)) await admin.query(`GRANT SELECT, DELETE ON ${T} TO ?@?`, [user, host]); }
}
