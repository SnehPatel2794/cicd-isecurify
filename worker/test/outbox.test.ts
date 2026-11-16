import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import crypto from 'node:crypto';
import { freshDb } from './helpers'; import { dispatchOutbox, retryDelaySeconds, MAX_TRIES, HOURLY_CAP } from '../src/outbox'; import { render } from '../src/mail/templates';
let db: Awaited<ReturnType<typeof freshDb>>; const pool = () => db.pool; const uid = () => crypto.randomUUID();
const T = uid(), A = uid(), B = uid(), C = uid();
before(async () => {
  db = await freshDb(); const p = pool();
  await p.query("INSERT INTO organizations(id,name) VALUES (?,?)", [T, 'Acme <Corp>']);
  for (const [id, em, n] of [[A, 'a@x.test', 'Ann'], [B, 'b@x.test', 'Bob'], [C, 'c@x.test', 'Cy']]) await p.query("INSERT INTO users(id,email,name) VALUES (?,?,?)", [id, em, n]);
  for (const id of [A, B]) await p.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES (?,?,'client_staff')", [T, id]);
});
after(() => db.close());
const note = async (user: string, kind = 'finding.assigned', read = false) => { const [r]: any = await pool().query("INSERT INTO notifications(tenant_id,user_id,kind,entity_type,entity_id,label,read_at) VALUES (?,?,?,'finding',?,?,?)", [T, user, kind, uid(), 'F-001 was assigned to you', read ? new Date() : null]); return Number(r.insertId); };
const ev = async (type: string, payload: any, key?: string) => { await pool().query('INSERT INTO outbox_events(tenant_id,type,payload,dedupe_key) VALUES (?,?,?,?)', [T, type, JSON.stringify(payload), key ?? null]); };
const jobs = async () => ((await pool().query("SELECT type,payload,idempotency_key k FROM jobs WHERE type='email.notification' ORDER BY id"))[0] as any[]);
const clear = async () => { await pool().query('DELETE FROM jobs'); await pool().query('DELETE FROM outbox_events'); await pool().query('DELETE FROM notification_prefs'); };

test('a notification event becomes one email job when the kind is emailed by default, exactly once', async () => {
  await clear(); const id = await note(A); await ev('notification.created', { notificationId: id, emailDefault: true }, `n:${id}`);
  const r = await dispatchOutbox(pool()); assert.deepEqual(r, { done: 1, retried: 0, dead: 0 }); const j = await jobs(); assert.equal(j.length, 1); assert.equal(j[0].k, `notif:${id}`);
  const pl = typeof j[0].payload === 'string' ? JSON.parse(j[0].payload) : j[0].payload; assert.equal(pl.to, 'a@x.test'); assert.equal(pl.org, 'Acme <Corp>');
  assert.deepEqual(await dispatchOutbox(pool()), { done: 0, retried: 0, dead: 0 }); assert.equal((await jobs()).length, 1);
  await assert.rejects(ev('notification.created', { notificationId: id }, `n:${id}`), /Duplicate/);   // the same notification cannot be announced twice
});
test('no email for kinds that are off by default, unless the person turned email on; a person can also turn a default off', async () => {
  await clear(); const a = await note(A, 'finding.comment'); await ev('notification.created', { notificationId: a, emailDefault: false }); await dispatchOutbox(pool()); assert.equal((await jobs()).length, 0);
  await pool().query("INSERT INTO notification_prefs(user_id,kind,in_app,email_on) VALUES (?,?,1,1)", [B, 'finding.comment']); const b = await note(B, 'finding.comment'); await ev('notification.created', { notificationId: b, emailDefault: false }); await dispatchOutbox(pool()); assert.equal((await jobs()).length, 1);
  await pool().query("INSERT INTO notification_prefs(user_id,kind,in_app,email_on) VALUES (?,?,1,0)", [A, 'finding.assigned']); const c = await note(A); await ev('notification.created', { notificationId: c, emailDefault: true }); await dispatchOutbox(pool()); assert.equal((await jobs()).length, 1);
});
test('no email for something already read, a disabled account, or a missing notification; these events are still marked done', async () => {
  await clear(); const read = await note(A, 'finding.assigned', true); await ev('notification.created', { notificationId: read, emailDefault: true });
  await pool().query("UPDATE users SET status='disabled' WHERE id=?", [C]); const dis = await note(C); await ev('notification.created', { notificationId: dis, emailDefault: true }); await ev('notification.created', { notificationId: 999999, emailDefault: true });
  const r = await dispatchOutbox(pool()); assert.equal(r.done, 3); assert.equal((await jobs()).length, 0); await pool().query("UPDATE users SET status='active' WHERE id=?", [C]);
});
test('hourly cap: a flood becomes the digest, not an inbox full of mail', async () => {
  await clear(); for (let i = 0; i < HOURLY_CAP; i++) await pool().query("INSERT INTO email_log(job_id,template,to_email,subject,status,attempts) VALUES (?,?,?,?,?,1)", [i + 1, 'email.notification', 'c@x.test', 's', 'sent']);
  const id = await note(C); await ev('notification.created', { notificationId: id, emailDefault: true }); await dispatchOutbox(pool()); assert.equal((await jobs()).length, 0);
});
test('scanner finding: uploader and requester are notified once, only if they still have access, and emailed', async () => {
  await clear(); await pool().query('DELETE FROM notifications'); const E = uid(), I = uid(), R = uid(), V = uid(); const c = await pool().getConnection();
  try { await c.query('SET FOREIGN_KEY_CHECKS=0'); await c.query("INSERT INTO evidence_requests(tenant_id,id,engagement_id,item_id,title,requested_by) VALUES (?,?,?,?,?,?)", [T, R, E, I, 'Firewall rules', B]);
    await c.query("INSERT INTO evidence_versions(tenant_id,id,request_id,version_no,kind,file_name,size_bytes,sha256,storage_key,uploaded_by) VALUES (?,?,?,?,?,?,?,?,?,?)", [T, V, R, 1, 'file', 'rules.xlsx', 1, 'a'.repeat(64), `evidence/${T}/${V}`, A]); } finally { await c.query('SET FOREIGN_KEY_CHECKS=1'); c.release(); }
  await ev('evidence.malware_found', { tenantId: T, versionId: V }, `malware:${V}`); assert.equal((await dispatchOutbox(pool())).done, 1);
  const [n]: any = await pool().query("SELECT user_id, label, entity_type, entity_id FROM notifications WHERE kind='evidence.malware' ORDER BY user_id"); assert.equal(n.length, 2); assert.ok(n.every((x: any) => x.entity_type === 'evidence_request' && x.entity_id === R)); assert.match(n[0].label, /rules\.xlsx/);
  assert.equal((await jobs()).length, 2);
  await pool().query("DELETE FROM memberships WHERE user_id=?", [A]); await pool().query('DELETE FROM notifications'); await pool().query('DELETE FROM jobs'); await pool().query('DELETE FROM outbox_events');
  await ev('evidence.malware_found', { tenantId: T, versionId: V }); await dispatchOutbox(pool()); const [m]: any = await pool().query("SELECT user_id FROM notifications WHERE kind='evidence.malware'"); assert.deepEqual(m.map((x: any) => x.user_id), [B]);   // A lost access
  await pool().query("INSERT INTO memberships(tenant_id,user_id,role) VALUES (?,?,'client_staff')", [T, A]);
});
test('a failing event is retried with back-off, then parked as dead; it never blocks later events and can be revived', async () => {
  await clear(); await ev('evidence.malware_found', { tenantId: T, versionId: 'x' });
  const c = await pool().getConnection(); await c.query("CREATE TRIGGER boom BEFORE INSERT ON notifications FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='boom'"); c.release();
  try {
    // make the event actually reach an insert
    const E = uid(), I = uid(), R = uid(), V = uid(); const k = await pool().getConnection();
    try { await k.query('SET FOREIGN_KEY_CHECKS=0'); await k.query("INSERT INTO evidence_requests(tenant_id,id,engagement_id,item_id,title,requested_by) VALUES (?,?,?,?,?,?)", [T, R, E, I, 'Req', B]); await k.query("INSERT INTO evidence_versions(tenant_id,id,request_id,version_no,kind,file_name,size_bytes,sha256,storage_key,uploaded_by) VALUES (?,?,?,?,?,?,?,?,?,?)", [T, V, R, 1, 'file', 'f', 1, 'a'.repeat(64), `evidence/${T}/${V}`, B]); } finally { await k.query('SET FOREIGN_KEY_CHECKS=1'); k.release(); }
    await pool().query('DELETE FROM outbox_events'); await ev('evidence.malware_found', { tenantId: T, versionId: V }); await ev('notification.created', { notificationId: 999999, emailDefault: true });
    const r1 = await dispatchOutbox(pool()); assert.equal(r1.retried, 1); assert.equal(r1.done, 1);   // the bad event waits; the later one still ran
    const [[row]]: any = await pool().query("SELECT attempts,last_error,next_try_at>NOW(3) later FROM outbox_events WHERE type='evidence.malware_found'"); assert.equal(row.attempts, 1); assert.match(row.last_error, /boom/); assert.equal(Number(row.later), 1);
    for (let i = 1; i < MAX_TRIES; i++) { await pool().query("UPDATE outbox_events SET next_try_at=NOW(3) WHERE processed_at IS NULL"); await dispatchOutbox(pool()); }
    const [[d]]: any = await pool().query("SELECT attempts, dead_at FROM outbox_events WHERE type='evidence.malware_found'"); assert.equal(d.attempts, MAX_TRIES); assert.ok(d.dead_at);
    assert.deepEqual(await dispatchOutbox(pool()), { done: 0, retried: 0, dead: 0 });
  } finally { const c2 = await pool().getConnection(); await c2.query('DROP TRIGGER boom'); c2.release(); }
});
test('back-off grows and is capped', () => { assert.ok(retryDelaySeconds(1) < retryDelaySeconds(2)); assert.equal(retryDelaySeconds(30), 3600); });
test('notification email: headline, one link to the app, hostile text neutralised, branded', () => {
  const m = render('email.notification', { name: 'Ann\r\nBcc: x@y', kind: 'finding.assigned', label: '<b>F-1</b>\nBcc: z', org: 'Acme' }, 'https://grc.example.com', { name: 'Acme GRC', primaryColor: '#123456' });
  assert.equal(m.subject, 'Acme GRC: A finding was assigned to you'); assert.ok(!/[\r\n]/.test(m.subject)); assert.ok(!m.html.includes('<b>F-1')); assert.ok(m.html.includes('#123456'));
  assert.deepEqual([...m.html.matchAll(/href="([^"]+)"/g)].map(x => x[1]), ['https://grc.example.com/notifications']); assert.equal(render('email.notification', { kind: 'zzz', label: 'x' }, 'https://a.b').subject, 'iSecurify GRC: New notification');
});
