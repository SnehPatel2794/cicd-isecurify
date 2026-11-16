import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import mysql from 'mysql2/promise';
import { freshEnv, ADMIN_URL } from './helpers'; import { applyGrants } from '../src/grants';
let env: Awaited<ReturnType<typeof freshEnv>>; let app: mysql.Connection, worker: mysql.Connection; let au: string, wu: string;
before(async () => {
  env = await freshEnv(); au = 'a' + env.name.slice(-8); wu = 'w' + env.name.slice(-8);
  await applyGrants(env.pool, env.name, au, 'app-pw-123', wu, 'worker-pw-123', '127.0.0.1');
  app = await mysql.createConnection({ host: '127.0.0.1', user: au, password: 'app-pw-123', database: env.name }); worker = await mysql.createConnection({ host: '127.0.0.1', user: wu, password: 'worker-pw-123', database: env.name });
});
after(async () => { await app.end(); await worker.end(); for (const u of [au, wu]) await env.pool.query('DROP USER IF EXISTS ?@?', [u, '127.0.0.1']); await env.close(); });

test('app account can read and write business tables', async () => { await app.query("INSERT INTO users(id,email,name) VALUES (UUID(),'a@b.test','A')"); assert.equal(((await app.query('SELECT COUNT(*) n FROM users'))[0] as any)[0].n, 1); });
test('app account can INSERT but not UPDATE or DELETE audit_events (privilege level)', async () => {
  await app.query("INSERT INTO audit_events(action) VALUES ('t')");
  await assert.rejects(app.query("UPDATE audit_events SET action='x'"), /denied/i); await assert.rejects(app.query('DELETE FROM audit_events'), /denied/i);
});
test('app account cannot run DDL or touch schema_migrations', async () => {
  await assert.rejects(app.query('DROP TABLE users'), /denied/i); await assert.rejects(app.query('CREATE TABLE x (a INT)'), /denied/i); await assert.rejects(app.query("INSERT INTO schema_migrations(name) VALUES ('x')"), /denied/i);
});
test('worker account can manage jobs but cannot write users or modify audit_events', async () => {
  await worker.query("INSERT INTO jobs(type) VALUES ('t')"); await worker.query("UPDATE jobs SET status='done'");
  await assert.rejects(worker.query("UPDATE users SET name='x'"), /denied/i); await assert.rejects(worker.query("UPDATE audit_events SET action='x'"), /denied/i);
});
test('user_deletion_log is insert-only for the app account (and by trigger)', async () => {
  await app.query("INSERT INTO users(id,email,name) VALUES ('u9','z@b.test','Z')");
  await app.query("INSERT INTO user_deletion_log(deleted_user_id,email_snapshot,name_snapshot,performed_by,backup_taken) VALUES ('u9','z@b.test','Z','u9',0)");
  await assert.rejects(app.query("UPDATE user_deletion_log SET reason='x'"), /denied/i); await assert.rejects(app.query('DELETE FROM user_deletion_log'), /denied/i);
  await assert.rejects(env.pool.query("UPDATE user_deletion_log SET reason='x'"), /append-only/);
});
test('app account can read and write the new tenancy tables, worker cannot write them', async () => {
  await app.query("INSERT INTO organizations(id,name) VALUES ('o1','Org')"); await app.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES ('o1','u9','client_admin')");
  await assert.rejects(worker.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES ('o1','u9','client_staff')"), /denied/i);
});
test('grants can be re-applied (idempotent)', async () => { await applyGrants(env.pool, env.name, au, 'app-pw-123', wu, 'worker-pw-123', '127.0.0.1'); await app.query('SELECT 1'); });
test('evidence versions, reviews and scans are insert-only for the app account; the worker may add scan results; templates are never deleted', async () => {
  for (const t of ['evidence_versions', 'evidence_reviews', 'evidence_scans']) { await assert.rejects(app.query(`UPDATE ${t} SET tenant_id=tenant_id`), /denied/i); await assert.rejects(app.query(`DELETE FROM ${t}`), /denied/i); }
  await assert.rejects(app.query('DELETE FROM evidence_templates'), /denied/i); await assert.rejects(worker.query('UPDATE evidence_templates SET active=0'), /denied/i);
  await assert.rejects(worker.query("INSERT INTO evidence_reviews(tenant_id,id,request_id,version_id,decision,note,reviewed_by) VALUES ('a','b','c','d','accepted','n','u')"), /denied/i);
  await assert.rejects(worker.query("INSERT INTO evidence_scans(tenant_id,id,version_id,status) VALUES ('o1','s1','nope','clean')"), /foreign key/i);   // INSERT is allowed; the composite FK then rejects the unknown version
});
test('email_log: the app account can only read it; the worker can add rows but never change or delete them', async () => {
  await assert.rejects(app.query("INSERT INTO email_log(job_id,template,to_email,subject,status,error) VALUES (1,'email.test','a@b.test','s','failed','x')"), /denied/i); await app.query('SELECT COUNT(*) FROM email_log');
  await worker.query("INSERT INTO email_log(job_id,template,to_email,subject,status,message_id) VALUES (1,'email.test','a@b.test','s','sent','<m@x>')");
  await assert.rejects(worker.query("INSERT INTO email_log(job_id,template,to_email,subject,status) VALUES (2,'email.test','a@b.test','s','failed')"), /./, 'a failed row needs an error');
  for (const sql of ["UPDATE email_log SET subject='x'", 'DELETE FROM email_log']) { await assert.rejects(app.query(sql), /denied/i); await assert.rejects(worker.query(sql), /denied/i); }
});
test('notifications: the app may add, mark read and purge them; the worker may add reminders, read and clean up (never edit); the identity of a notification can never change', async () => {
  await app.query("INSERT INTO users(id,email,name) VALUES ('nu','nu@b.test','N')"); await app.query("INSERT INTO organizations(id,name) VALUES ('no','NOrg')");
  await app.query("INSERT INTO notifications(tenant_id,user_id,kind,entity_type,entity_id,label) VALUES ('no','nu','finding.comment','finding','f','F-001')"); await app.query('UPDATE notifications SET read_at=NOW(3)');
  await assert.rejects(app.query("UPDATE notifications SET label='x'"), /only read_at/i); await worker.query("INSERT INTO notifications(tenant_id,user_id,kind,entity_type,entity_id,label) VALUES ('no','nu','reminder.overdue','finding','f','x')"); await assert.rejects(worker.query('UPDATE notifications SET read_at=NULL'), /denied/i);   // the worker adds reminders; it can never edit one
  await worker.query('SELECT COUNT(*) FROM notifications'); await worker.query('DELETE FROM notifications'); await assert.rejects(worker.query('DELETE FROM notification_prefs'), /denied/i); await assert.rejects(worker.query("INSERT INTO notification_prefs(user_id,kind) VALUES ('nu','x')"), /denied/i);
});
test('reminder_log is written only by the worker; user_digest is chosen by people and only timestamped by the worker', async () => {
  await app.query("INSERT INTO users(id,email,name) VALUES ('ru','ru@b.test','R')");
  await assert.rejects(app.query("INSERT INTO reminder_log(entity_type,entity_id,user_id,stage,due_date) VALUES ('finding','f','ru','overdue','2026-01-01')"), /denied/i); await worker.query("INSERT INTO reminder_log(entity_type,entity_id,user_id,stage,due_date) VALUES ('finding','f','ru','overdue','2026-01-01')");
  await assert.rejects(worker.query('UPDATE reminder_log SET bucket=3'), /denied/i); await app.query('SELECT COUNT(*) FROM reminder_log'); await app.query('DELETE FROM reminder_log');
  await app.query("INSERT INTO user_digest(user_id,frequency) VALUES ('ru','weekly')"); await worker.query('UPDATE user_digest SET last_sent_at=NOW(3)'); await assert.rejects(worker.query('DELETE FROM user_digest'), /denied/i);
});
test('report_exports: the app can read and add rows, nobody can change or delete them, and the worker may only read', async () => {
  await assert.rejects(app.query("UPDATE report_exports SET format='xlsx'"), /denied/i); await assert.rejects(app.query('DELETE FROM report_exports'), /denied/i); await app.query('SELECT COUNT(*) FROM report_exports'); await worker.query('SELECT COUNT(*) FROM report_exports');
  await assert.rejects(worker.query("INSERT INTO report_exports(id,tenant_id,engagement_id,format,sha256,size_bytes,engagement_status,generated_by) VALUES ('a','b','c','pdf',REPEAT('a',64),1,'active','u')"), /denied/i);
});
test('certificates: the app can read, add and update rows but never delete; the worker may only read', async () => {
  await assert.rejects(app.query('DELETE FROM certificates'), /denied/i); await app.query('SELECT COUNT(*) FROM certificates'); await worker.query('SELECT COUNT(*) FROM certificates');
  await assert.rejects(worker.query("UPDATE certificates SET revoke_reason='x'"), /denied/i); await assert.rejects(worker.query('DELETE FROM certificates'), /denied/i);
});
test('finding_imports: the app can read and add rows but never change or delete them; the worker may only read', async () => {
  await assert.rejects(app.query("UPDATE finding_imports SET format='json'"), /denied/i); await assert.rejects(app.query('DELETE FROM finding_imports'), /denied/i); await app.query('SELECT COUNT(*) FROM finding_imports'); await worker.query('SELECT COUNT(*) FROM finding_imports');
  await assert.rejects(worker.query("INSERT INTO finding_imports(tenant_id,id,engagement_id,source_name,format,sha256,total_rows,created_count,duplicate_count,invalid_count,imported_by) VALUES ('a','b','c','x','csv',REPEAT('a',64),1,1,0,0,'u')"), /denied/i);
});
test('mapping_change_requests: the app can read, add and decide them but never delete; the worker may only read', async () => {
  await assert.rejects(app.query('DELETE FROM mapping_change_requests'), /denied/i); await app.query('SELECT COUNT(*) FROM mapping_change_requests'); await worker.query('SELECT COUNT(*) FROM mapping_change_requests'); await assert.rejects(worker.query("UPDATE mapping_change_requests SET status='withdrawn'"), /denied/i);
});
test('risks: the app can read, add and update but never delete; risk events are insert-only; the worker may only read', async () => {
  await assert.rejects(app.query('DELETE FROM risks'), /denied/i); await assert.rejects(app.query("UPDATE risk_events SET note='x'"), /denied/i); await assert.rejects(app.query('DELETE FROM risk_events'), /denied/i); for (const t of ['risks', 'risk_events', 'risk_links']) { await app.query(`SELECT COUNT(*) FROM ${t}`); await worker.query(`SELECT COUNT(*) FROM ${t}`); }
  await assert.rejects(worker.query("UPDATE risks SET title='x'"), /denied/i); await assert.rejects(worker.query('DELETE FROM risk_links'), /denied/i);
});
test('policies and incidents: never deleted; acknowledgements and events insert-only; only drafts can be removed; the worker may only read', async () => {
  for (const t of ['policies', 'incidents', 'policy_acks', 'policy_events', 'incident_events']) await assert.rejects(app.query(`DELETE FROM ${t}`), /denied/i);
  for (const t of ['policy_acks', 'policy_events', 'incident_events']) await assert.rejects(app.query(`UPDATE ${t} SET tenant_id=tenant_id`), /denied/i);
  for (const t of ['policies', 'policy_versions', 'policy_acks', 'policy_events', 'incidents', 'incident_events', 'incident_risks']) { await app.query(`SELECT COUNT(*) FROM ${t}`); await worker.query(`SELECT COUNT(*) FROM ${t}`); await assert.rejects(worker.query(`DELETE FROM ${t}`), /denied/i); }
  await app.query("DELETE FROM policy_versions WHERE 1=0"); await app.query("DELETE FROM incident_risks WHERE 1=0"); await assert.rejects(worker.query("UPDATE incidents SET title='x'"), /denied/i);
});
test('saved views: the app can read, add and delete them, the worker may only read', async () => {
  await app.query('SELECT COUNT(*) FROM saved_views'); await app.query('DELETE FROM saved_views WHERE 1=0'); await worker.query('SELECT COUNT(*) FROM saved_views'); await assert.rejects(worker.query('DELETE FROM saved_views'), /denied/i); await assert.rejects(worker.query("UPDATE saved_views SET name='x'"), /denied/i);
});
test('backup_log: the app and worker can only read it; the scripts write it as root', async () => {
  await app.query('SELECT COUNT(*) FROM backup_log'); await worker.query('SELECT COUNT(*) FROM backup_log');
  for (const c of [app, worker]) { await assert.rejects(c.query("INSERT INTO backup_log(kind,ok) VALUES ('backup',1)"), /denied/i); await assert.rejects(c.query('DELETE FROM backup_log'), /denied/i); }
});
test('vendors: never deleted; events insert-only; the worker may only read', async () => {
  for (const t of ['vendors', 'vendor_assessments', 'vendor_events']) { await assert.rejects(app.query(`DELETE FROM ${t}`), /denied/i); await app.query(`SELECT COUNT(*) FROM ${t}`); await worker.query(`SELECT COUNT(*) FROM ${t}`); await assert.rejects(worker.query(`DELETE FROM ${t}`), /denied/i); }
  await assert.rejects(app.query("UPDATE vendor_events SET note='x'"), /denied/i); await assert.rejects(worker.query("UPDATE vendors SET name='x'"), /denied/i);
});
test('evidence archive: never deleted; the app may restore (update), the worker may only add rows', async () => {
  await assert.rejects(app.query('DELETE FROM evidence_archive'), /denied/i); await assert.rejects(worker.query('DELETE FROM evidence_archive'), /denied/i); await assert.rejects(worker.query("UPDATE evidence_archive SET restored_at=NOW()"), /denied/i);
  await app.query('SELECT COUNT(*) FROM evidence_archive'); await worker.query('SELECT COUNT(*) FROM evidence_archive');
});
test('migrator account: can change this database and grant the app/worker rights, but nothing outside it', async () => {
  const { applyMigratorGrants } = await import('../src/grants'); const mu = 'm' + env.name.slice(-8); await applyMigratorGrants(env.pool, env.name, mu, 'migr-pw-123', '127.0.0.1');
  const mig = await mysql.createConnection({ host: '127.0.0.1', user: mu, password: 'migr-pw-123', database: env.name });
  try {
    await mig.query('CREATE TABLE zz_probe (id INT PRIMARY KEY)'); await mig.query('ALTER TABLE zz_probe ADD COLUMN x INT'); await mig.query('DROP TABLE zz_probe');
    const a2 = 'b' + env.name.slice(-8), w2 = 'x' + env.name.slice(-8); await applyGrants(mig as any, env.name, a2, 'app2-pw-123', w2, 'worker2-pw-123', '127.0.0.1');   // the same grants run as the migrator
    const app2 = await mysql.createConnection({ host: '127.0.0.1', user: a2, password: 'app2-pw-123', database: env.name }); try { await app2.query('SELECT COUNT(*) FROM users'); await assert.rejects(app2.query('DELETE FROM audit_events'), /denied/i); } finally { await app2.end(); }
    for (const u of [a2, w2]) await env.pool.query('DROP USER IF EXISTS ?@?', [u, '127.0.0.1']);
    await assert.rejects(mig.query('SELECT user FROM mysql.user'), /denied/i); await assert.rejects(mig.query('CREATE DATABASE zz_other'), /denied/i); await assert.rejects(mig.query('CREATE TABLE mysql.zz (id INT)'), /denied/i);
    await assert.rejects(mig.query('SET GLOBAL max_connections=5'), /denied|privilege|SUPER/i); await assert.rejects(mig.query("SELECT LOAD_FILE('/etc/passwd')").then(r => { if ((r[0] as any)[0][Object.keys((r[0] as any)[0])[0]] !== null) throw new Error('file read worked'); throw new Error('denied: no file'); }), /denied/i);
  } finally { await mig.end(); await env.pool.query('DROP USER IF EXISTS ?@?', [mu, '127.0.0.1']); }
});

test('the optional purge account can only read and delete tenant rows; the delete triggers still protect a real organization', async () => {
  const pu = 'p' + env.name.slice(-8); const { applyPurgeGrants } = await import('../src/grants'); const [tb] = await env.pool.query("SELECT table_name t FROM information_schema.tables WHERE table_schema=? AND table_type='BASE TABLE'", [env.name]) as any;
  await applyPurgeGrants(env.pool, env.name, pu, 'purge-pw-123', '127.0.0.1', tb.map((r: any) => r.t ?? r.TABLE_NAME)); const pc = await mysql.createConnection({ host: '127.0.0.1', user: pu, password: 'purge-pw-123', database: env.name });
  try {
    await app.query("INSERT INTO organizations(id,name,created_by) VALUES ('real1','Real','u9'),('demo1','Demo','u9')").catch(async () => { await app.query("INSERT INTO organizations(id,name) VALUES ('real1','Real'),('demo1','Demo')"); }); await env.pool.query("UPDATE organizations SET is_demo=0 WHERE id='real1'"); 
    await assert.rejects(pc.query("INSERT INTO tasks(tenant_id,id,engagement_id,task_no,title,created_by) VALUES ('real1','t','e',1,'x','u')"), /denied/i, 'cannot add tenant rows');
    await assert.rejects(pc.query("UPDATE users SET name='x'"), /denied/i); await assert.rejects(pc.query('DROP TABLE users'), /denied/i); await assert.rejects(pc.query("UPDATE tasks SET title='x'"), /denied/i);
    await pc.query("SELECT COUNT(*) FROM tasks"); await pc.query("DELETE FROM tasks WHERE tenant_id='nobody'");
    await app.query("INSERT INTO audit_events(tenant_id,action) VALUES ('real1','t')"); await assert.rejects(pc.query("DELETE FROM audit_events WHERE tenant_id='real1'"), /append-only/, 'privileged, but the trigger refuses for a real organization');
    await assert.rejects(pc.query("UPDATE organizations SET purge_started_at=NOW(3) WHERE id='real1'"), /only a demo organization/); await assert.rejects(pc.query("DELETE FROM organizations WHERE id='real1'"), /being wiped/);
    await assert.rejects(app.query("DELETE FROM audit_events WHERE tenant_id='real1'"), /denied/i, 'the application account still cannot delete');
  } finally { await pc.end(); await env.pool.query('DROP USER IF EXISTS ?@?', [pu, '127.0.0.1']); }
});
