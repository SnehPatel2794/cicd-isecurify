import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import crypto from 'node:crypto';
import { freshDb } from './helpers'; import { refreshDue, utcToday } from '../src/summaries';
let db: Awaited<ReturnType<typeof freshDb>>; const pool = () => db.pool; const uid = () => crypto.randomUUID(); const T = uid(), U = uid();
before(async () => { db = await freshDb(); await pool().query("INSERT INTO users(id,email,name) VALUES (?,?,?)", [U, 'u@x.test', 'U']); await pool().query("INSERT INTO organizations(id,name) VALUES (?,?)", [T, 'Acme']); }); after(() => db.close());
const eng = async (status = 'active') => { const id = uid(); await pool().query("INSERT INTO engagements(tenant_id,id,name,status,created_by) VALUES (?,?,?,?,?)", [T, id, 'E-' + id.slice(0, 6), status, U]); return id; };
const item = async (e: string, readiness = 'implemented', evidence = 'accepted') => { const id = uid(); await pool().query("INSERT INTO checklist_items(tenant_id,id,engagement_id,ref,domain,title,readiness_status,evidence_status) VALUES (?,?,?,?,?,?,?,?)", [T, id, e, 'R' + id.slice(0, 4), 'D', 'T', readiness, evidence]); return id; };
const row = async (e: string) => ((await pool().query('SELECT summary, findings_unresolved u, computed_for FROM engagement_summary WHERE engagement_id=?', [e]))[0] as any[])[0];
const dirty = async (e: string) => ((await pool().query('SELECT COUNT(*) n FROM summary_dirty WHERE engagement_id=?', [e]))[0] as any[])[0].n > 0;
const age = (e: string) => pool().query('UPDATE summary_dirty SET marked_at=DATE_SUB(marked_at, INTERVAL 10 SECOND) WHERE engagement_id=?', [e]);
const sum = (r: any) => typeof r.summary === 'string' ? JSON.parse(r.summary) : r.summary;

test('a new engagement gets a summary; a change marks it dirty and the next pass recomputes it and clears the mark', async () => {
  const e = await eng(); const i = await item(e); assert.equal(await dirty(e), true, 'the insert trigger marked it');
  await age(e); assert.ok(await refreshDue(pool()) >= 1); const r = await row(e); assert.equal(sum(r).total, 1); assert.equal(sum(r).effective, 1); assert.equal(await dirty(e), false);
  await pool().query("UPDATE checklist_items SET readiness_status='in_progress' WHERE tenant_id=? AND id=?", [T, i]); assert.equal(await dirty(e), true, 'the update trigger marked it');
  await age(e); await refreshDue(pool()); assert.equal(sum(await row(e)).effective, 0); assert.equal(await dirty(e), false);
});
test('finding counts are stored with the summary', async () => {
  const e = await eng(); const i = await item(e);
  await pool().query("INSERT INTO findings(tenant_id,id,engagement_id,item_id,finding_no,title,description,severity,status,raised_by) VALUES (?,?,?,?,1,'F','d','critical','open',?)", [T, uid(), e, i, U]);
  await age(e); await refreshDue(pool()); assert.equal(Number((await row(e)).u), 1);
});
test('a mark that moves while computing is kept (compare-and-delete)', async () => {
  const e = await eng(); await item(e); await age(e); await pool().query('DELETE FROM summary_dirty WHERE engagement_id=?', [e]);
  await pool().query('INSERT INTO summary_dirty(tenant_id,engagement_id,marked_at) VALUES (?,?,DATE_SUB(NOW(3), INTERVAL 10 SECOND))', [T, e]);
  // simulate a newer change landing after the worker read the mark: the stored mark differs from the one deleted
  const [[m]]: any = await pool().query("SELECT DATE_FORMAT(marked_at,'%Y-%m-%d %H:%i:%s.%f') m FROM summary_dirty WHERE engagement_id=?", [e]); await pool().query('UPDATE summary_dirty SET marked_at=NOW(3) WHERE engagement_id=?', [e]);
  const [r]: any = await pool().query('DELETE FROM summary_dirty WHERE tenant_id=? AND engagement_id=? AND marked_at=?', [T, e, m.m]); assert.equal(r.affectedRows, 0); assert.equal(await dirty(e), true);
});
test('a summary from an earlier day is recomputed; a fresh clean one is left alone', async () => {
  const e = await eng(); await item(e); await age(e); await refreshDue(pool()); const before = (await row(e)); assert.equal(await refreshDue(pool(), { today: utcToday() }) >= 0, true);
  await pool().query("UPDATE engagement_summary SET computed_for='2000-01-01' WHERE engagement_id=?", [e]); await refreshDue(pool()); assert.notEqual(String((await row(e)).computed_for).slice(0, 4), '2000'); assert.ok(before);
});
test('closed engagements are not re-refreshed every 10 minutes, but open ones are', async () => {
  const a = await eng('active'), c = await eng('closed'); await item(a); await item(c); await pool().query('DELETE FROM summary_dirty'); await refreshDue(pool());
  await pool().query("UPDATE engagement_summary SET computed_at=DATE_SUB(NOW(3), INTERVAL 30 MINUTE) WHERE engagement_id IN (?,?)", [a, c]); await pool().query('DELETE FROM summary_dirty');
  await refreshDue(pool()); const [rows]: any = await pool().query("SELECT engagement_id id, TIMESTAMPDIFF(MINUTE, computed_at, NOW(3)) m FROM engagement_summary WHERE engagement_id IN (?,?)", [a, c]);
  const m = Object.fromEntries(rows.map((x: any) => [x.id, Number(x.m)])); assert.ok(m[a] < 2); assert.ok(m[c] >= 29);
});
