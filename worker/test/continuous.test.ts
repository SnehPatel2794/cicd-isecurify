import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import crypto from 'node:crypto';
import { freshDb } from './helpers'; import { stageOf, noticeLabel, candidates, sendNotices, snapshotPosture, runContinuous } from '../src/continuous';
let db: Awaited<ReturnType<typeof freshDb>>; const pool = () => db.pool; const uid = () => crypto.randomUUID(); const T = uid(), U = uid(), V = uid();
const today = new Date().toISOString().slice(0, 10); const days = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const q = async (s: string, p: any[] = []) => ((await pool().query(s, p)) as any)[0] as any[];
let E: string, I1: string, I2: string, FW: string;
before(async () => {
  db = await freshDb(); await q("INSERT INTO users(id,email,name) VALUES (?,?,?),(?,?,?)", [U, 'u@x.test', 'U', V, 'v@x.test', 'V']); await q("INSERT INTO organizations(id,name) VALUES (?,?)", [T, 'Acme']); await q("INSERT INTO memberships(tenant_id,user_id,role) VALUES (?,?,'client_staff')", [T, V]);
  FW = uid(); const rel = uid(); const c1 = uid(), c2 = uid(); await q("INSERT INTO frameworks(id,name,created_by) VALUES (?,?,?)", [FW, 'FW', U]); await q("INSERT INTO framework_releases(id,framework_id,version,status) VALUES (?,?,1,'draft')", [rel, FW]);
  await q("INSERT INTO framework_controls(id,release_id,ref,domain,title) VALUES (?,?,'C1','D','t'),(?,?,'C2','D','t')", [c1, rel, c2, rel]); await q("UPDATE framework_releases SET status='published', published_at=NOW(3), published_by=? WHERE id=?", [U, rel]); E = uid(); await q("INSERT INTO engagements(tenant_id,id,name,status,created_by) VALUES (?,?,?,'active',?)", [T, E, 'E', U]);
  await q("INSERT INTO engagement_frameworks(tenant_id,engagement_id,framework_id,release_id,is_primary,added_by) VALUES (?,?,?,?,1,?)", [T, E, FW, rel, U]);
  I1 = uid(); I2 = uid(); await q("INSERT INTO checklist_items(tenant_id,id,engagement_id,ref,domain,title,readiness_status,evidence_status,accountable_user_id) VALUES (?,?,?,'C1','D','t','implemented','accepted',?),(?,?,?,'C2','D','t','not_started','not_requested',?)", [T, I1, E, V, T, I2, E, V]);
  await q("INSERT INTO checklist_item_controls(tenant_id,engagement_id,item_id,control_id) VALUES (?,?,?,?),(?,?,?,?)", [T, E, I1, c1, T, E, I2, c2]);
}); after(() => db.close());
const test1 = (title: string, due: string, extra = '') => q(`INSERT INTO control_tests(tenant_id,id,engagement_id,item_id,title,frequency,next_due_on,created_by) VALUES (?,?,?,?,?,'monthly',?,?)`, [T, uid(), E, I1, title, due, U]);

test('stages: not yet due is silent; due until a week late; overdue after that', () => {
  assert.equal(stageOf('2026-11-02', '2026-11-01'), null); assert.equal(stageOf('2026-11-01', '2026-11-01'), 'due'); assert.equal(stageOf('2026-10-26', '2026-11-01'), 'due'); assert.equal(stageOf('2026-10-25', '2026-11-01'), 'overdue');
  assert.match(noticeLabel('test', 'C1: x', '2026-10-25', 'overdue', '2026-11-01'), /overdue by 7 days/); assert.match(noticeLabel('refresh', 'C1: x', '2026-11-01', 'due', '2026-11-01'), /evidence refresh due today/);
});
test('one notice per person, thing, due date and stage; running twice adds nothing; the next stage adds one', async () => {
  await test1('Restore backup', days(-1)); const c = await candidates(pool(), today); assert.equal(c.filter(x => x.userId === V).length, 1);
  assert.equal(await sendNotices(pool(), today, c), 1); assert.equal(await sendNotices(pool(), today, c), 0); assert.equal((await q("SELECT COUNT(*) n FROM notifications WHERE kind='control_test.due' AND user_id=?", [V]))[0].n, 1);
  const later = days(8); assert.equal(await sendNotices(pool(), later, await candidates(pool(), later)), 0, 'the earlier one is still unread, so no pile-up'); await q("UPDATE notifications SET read_at=NOW(3) WHERE kind='control_test.due'"); assert.equal(await sendNotices(pool(), later, await candidates(pool(), later)), 1, 'overdue is a new stage');
});
test('people who switched the kind off, not-applicable items, paused tests, closed engagements and disabled users get nothing', async () => {
  await q("DELETE FROM notifications"); await q("DELETE FROM continuous_notice_log"); await q("DELETE FROM control_tests"); await q("INSERT INTO notification_prefs(user_id,kind,in_app) VALUES (?,?,0)", [V, 'control_test.due']); await test1('a', days(-2)); assert.equal(await sendNotices(pool(), today, await candidates(pool(), today)), 0); await q("DELETE FROM notification_prefs");
  await q("UPDATE control_tests SET status='paused'"); assert.equal((await candidates(pool(), today)).length, 0); await q("UPDATE control_tests SET status='active'"); await q("UPDATE checklist_items SET readiness_status='not_applicable', na_justification='out' WHERE id=?", [I1]); assert.equal((await candidates(pool(), today)).length, 0); await q("UPDATE checklist_items SET readiness_status='implemented', na_justification=NULL WHERE id=?", [I1]);
  await q("UPDATE engagements SET status='closed', closed_at=NOW(3) WHERE id=?", [E]); assert.equal((await candidates(pool(), today)).length, 0); await q("UPDATE engagements SET status='active', closed_at=NULL WHERE id=?", [E]); await q("UPDATE users SET status='disabled' WHERE id=?", [V]); assert.equal((await candidates(pool(), today)).length, 0); await q("UPDATE users SET status='active' WHERE id=?", [V]); assert.equal((await candidates(pool(), today)).length, 1);
});
test('evidence schedules that are due remind the accountable person', async () => {
  await q("DELETE FROM control_tests"); await q("INSERT INTO evidence_schedules(tenant_id,id,engagement_id,item_id,title,every_months,next_run_on,created_by) VALUES (?,?,?,?,?,3,?,?)", [T, uid(), E, I1, 'Access review', days(-1), U]);
  const c = await candidates(pool(), today); assert.ok(c.some(x => x.type === 'evidence_schedule' && x.userId === V)); await q("DELETE FROM notifications"); await sendNotices(pool(), today, c); assert.equal((await q("SELECT COUNT(*) n FROM notifications WHERE kind='evidence.refresh_due' AND user_id=?", [V]))[0].n, 1);
});
test('posture snapshot: one row per framework and day, correct numbers, replaced (not duplicated) when run again, includes test health', async () => {
  await test1('T-overdue', days(-3)); await q("UPDATE control_tests SET last_result='fail', last_run_on=?, next_due_on=? WHERE title='T-overdue'", [days(-10), days(-3)]);
  assert.equal(await snapshotPosture(pool(), today), 1); let r = (await q("SELECT * FROM posture_snapshots WHERE engagement_id=?", [E]))[0]; assert.equal(r.framework_id, FW); assert.equal(r.applicable, 2); assert.equal(r.effective, 1); assert.equal(Number(r.percent), 50); assert.equal(r.tests_total, 1); assert.equal(r.tests_overdue, 1); assert.equal(r.tests_failing, 1);
  await q("UPDATE checklist_items SET readiness_status='implemented', evidence_status='accepted' WHERE id=?", [I2]); await snapshotPosture(pool(), today); const all = await q("SELECT * FROM posture_snapshots WHERE engagement_id=?", [E]); assert.equal(all.length, 1); assert.equal(Number(all[0].percent), 100);
  await snapshotPosture(pool(), days(1)); assert.equal((await q("SELECT COUNT(*) n FROM posture_snapshots WHERE engagement_id=?", [E]))[0].n, 2, 'a new day adds a row');
});
test('closed engagements and inactive organizations are not snapshotted; the daily run reports its counts', async () => {
  await q("DELETE FROM posture_snapshots"); await q("UPDATE engagements SET status='closed', closed_at=NOW(3) WHERE id=?", [E]); assert.equal(await snapshotPosture(pool(), today), 0); await q("UPDATE engagements SET status='active', closed_at=NULL WHERE id=?", [E]);
  const out = await runContinuous(pool(), new Date(), { info: () => {}, warn: () => {} }); assert.equal(out.snapshots, 1); assert.ok(out.candidates >= 1);
});
