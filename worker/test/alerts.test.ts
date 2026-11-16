import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import crypto from 'node:crypto'; import os from 'node:os';
import { freshDb } from './helpers'; import { alertsFrom, alertKey, gatherState, queueAlerts, type State } from '../src/alerts'; import { render } from '../src/mail/templates';
const NOW = Date.UTC(2026, 9, 28, 12); const H = 3600_000, D = 24 * H; const ok = (ago: number) => ({ ok: true, at: NOW - ago });
const base = (o: Partial<State> = {}): State => ({ now: NOW, lastBackup: ok(5 * H), lastBackupTry: ok(5 * H), lastOffsite: null, lastOffsiteTry: null, lastDrill: ok(2 * D), lastDrillTry: ok(2 * D), offsiteUsed: false, disk: { freeBytes: 50e9, minFreeBytes: 2e9 }, nearQuota: [], ...o });
const codes = (s: State) => alertsFrom(s).map(a => a.code);
test('healthy installation: no alerts, and no off-server alerts when it is not configured', () => assert.deepEqual(codes(base()), []));
test('backups: never, stale, failed since the last good one', () => {
  assert.deepEqual(codes(base({ lastBackup: null, lastBackupTry: null, lastDrill: null, lastDrillTry: null })), ['backup.never']); assert.deepEqual(codes(base({ lastBackup: ok(40 * H), lastBackupTry: ok(40 * H) })), ['backup.stale']);
  assert.deepEqual(codes(base({ lastBackupTry: { ok: false, at: NOW - H } })), ['backup.failed']); assert.deepEqual(codes(base({ lastBackup: ok(H), lastBackupTry: ok(H) })), [], 'an old failure after a newer success is history');
});
test('off-server copy: only judged once it has been used; never, stale, failed', () => {
  assert.deepEqual(codes(base({ offsiteUsed: true })), ['offsite.never']); assert.deepEqual(codes(base({ offsiteUsed: true, lastOffsite: ok(50 * H), lastOffsiteTry: ok(50 * H) })), ['offsite.stale']);
  assert.deepEqual(codes(base({ offsiteUsed: true, lastOffsite: ok(5 * H), lastOffsiteTry: { ok: false, at: NOW - H } })), ['offsite.failed']); assert.deepEqual(codes(base({ offsiteUsed: true, lastOffsite: ok(5 * H), lastOffsiteTry: ok(5 * H) })), []);
});
test('restore drill: never, overdue after 10 days, failed', () => {
  assert.deepEqual(codes(base({ lastDrill: null, lastDrillTry: null })), ['drill.never']); assert.deepEqual(codes(base({ lastDrill: ok(11 * D), lastDrillTry: ok(11 * D) })), ['drill.overdue']); assert.deepEqual(codes(base({ lastDrillTry: { ok: false, at: NOW - H } })), ['drill.failed']);
});
test('disk and storage limits', () => {
  assert.deepEqual(codes(base({ disk: { freeBytes: 1e9, minFreeBytes: 2e9 } })), ['disk.low']); assert.deepEqual(codes(base({ disk: null })), []); const a = alertsFrom(base({ nearQuota: [{ name: 'Acme', percent: 95 }] })); assert.equal(a.length, 1); assert.match(a[0].text, /Acme has used 95%/);
});
test('alert key: same set, same key; a new problem gives a new key; a new day gives a new key', () => {
  const a = [{ code: 'x', text: '' }, { code: 'y', text: '' }]; assert.equal(alertKey('d1', 'u', a), alertKey('d1', 'u', [...a].reverse())); assert.notEqual(alertKey('d1', 'u', a), alertKey('d1', 'u', [...a, { code: 'z', text: '' }])); assert.notEqual(alertKey('d1', 'u', a), alertKey('d2', 'u', a)); assert.ok(alertKey('d1', 'u', a).length < 190);
});
test('alert email: lists the items, one link to System status, hostile text neutralised', () => {
  const m = render('email.alert', { name: 'Ann', alerts: ['Backup is old', '<script>x</script>\r\nBcc: z'] }, 'https://grc.example.com'); assert.match(m.subject, /attention needed \(2\)/); assert.ok(!/[\r\n]/.test(m.subject)); assert.ok(!m.html.includes('<script>')); assert.deepEqual([...m.html.matchAll(/href="([^"]+)"/g)].map(x => x[1]), ['https://grc.example.com/platform/system']);
});
let db: Awaited<ReturnType<typeof freshDb>>; before(async () => { db = await freshDb(); }); after(() => db.close());
const uid = () => crypto.randomUUID();
test('database: state is read from backup_log, administrators get one email per day per set of alerts, nobody else', async () => {
  const p = db.pool; const A = uid(), B = uid(), C = uid(), T = uid();
  await p.query("INSERT INTO users(id,email,name,platform_role) VALUES (?,?,?,'super_admin'),(?,?,?,'admin'),(?,?,?,'isecurify_team')", [A, 'a@x.test', 'A', B, 'b@x.test', 'B', C, 'c@x.test', 'C']);
  await p.query("INSERT INTO organizations(id,name) VALUES (?,?)", [T, 'Acme']); await p.query("INSERT INTO evidence_usage(tenant_id,used_bytes,quota_bytes) VALUES (?,950,1000)", [T]);
  await p.query("INSERT INTO backup_log(kind,ok,taken_at) VALUES ('backup',1,NOW(3) - INTERVAL 50 HOUR),('offsite',0,NOW(3) - INTERVAL 1 HOUR)");
  const st = await gatherState(p, { evidenceDir: os.tmpdir(), minFreeBytes: 1 }); assert.equal(st.offsiteUsed, true); assert.equal(st.lastOffsite, null); assert.equal(st.nearQuota[0].percent, 95); const c = alertsFrom(st).map(a => a.code); for (const x of ['backup.stale', 'offsite.never', 'offsite.failed', 'drill.never']) assert.ok(c.includes(x), x);
  assert.equal(await queueAlerts(p, st), 2); assert.equal(await queueAlerts(p, st), 0, 'the same problem is not mailed again the same day');
  const [j]: any = await p.query("SELECT payload FROM jobs WHERE type='email.alert'"); assert.equal(j.length, 2); const to = j.map((x: any) => (typeof x.payload === 'string' ? JSON.parse(x.payload) : x.payload).to).sort(); assert.deepEqual(to, ['a@x.test', 'b@x.test']);
  await p.query("INSERT INTO backup_log(kind,ok) VALUES ('backup',0)"); assert.equal(await queueAlerts(p, await gatherState(p, { evidenceDir: os.tmpdir(), minFreeBytes: 1 })), 2, 'a new kind of problem is mailed at once');
  const healthy = await gatherState(p, { evidenceDir: os.tmpdir(), minFreeBytes: 1 }); await p.query('DELETE FROM jobs'); assert.equal(await queueAlerts(p, { ...healthy, ...base() }), 0, 'nothing to say, nothing sent');
});
