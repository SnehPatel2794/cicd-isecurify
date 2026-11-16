import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import crypto from 'node:crypto';
import { freshDb } from './helpers'; import { archiveDue } from '../src/archive';
let db: Awaited<ReturnType<typeof freshDb>>; const pool = () => db.pool; const uid = () => crypto.randomUUID(); const T = uid(), U = uid();
before(async () => { db = await freshDb(); await pool().query("INSERT INTO users(id,email,name) VALUES (?,?,?)", [U, 'u@x.test', 'U']); await pool().query("INSERT INTO organizations(id,name,retention_months) VALUES (?,?,12)", [T, 'Acme']); }); after(() => db.close());
const eng = async (o: { status?: string; closedMonthsAgo?: number | null; hold?: boolean; requests?: number } = {}) => {
  const id = uid(); const c = await pool().getConnection();
  try { await c.query('SET FOREIGN_KEY_CHECKS=0');
    await c.query("INSERT INTO engagements(tenant_id,id,name,status,created_by,closed_at,legal_hold) VALUES (?,?,?,?,?,?,?)", [T, id, 'E-' + id.slice(0, 6), o.status ?? 'closed', U, o.closedMonthsAgo == null ? null : new Date(Date.now() - o.closedMonthsAgo * 31 * 86400_000), o.hold ? 1 : 0]);
    for (let i = 0; i < (o.requests ?? 1); i++) await c.query("INSERT INTO evidence_requests(tenant_id,id,engagement_id,item_id,title,requested_by) VALUES (?,?,?,?,?,?)", [T, uid(), id, uid(), 'R', U]);
  } finally { await c.query('SET FOREIGN_KEY_CHECKS=1'); c.release(); } return id;
};
const archived = async () => ((await pool().query('SELECT engagement_id id, request_count n, retention_months m FROM evidence_archive'))[0] as any[]);

test('only engagements closed longer than the retention period, with evidence, and with no hold are archived; each is audited once', async () => {
  const old = await eng({ closedMonthsAgo: 14, requests: 3 }); await eng({ closedMonthsAgo: 6 }); await eng({ status: 'active', closedMonthsAgo: null }); await eng({ closedMonthsAgo: 20, hold: true }); await eng({ closedMonthsAgo: 20, requests: 0 });
  assert.equal(await archiveDue(pool()), 1); const a = await archived(); assert.deepEqual(a.map(x => [x.id, Number(x.n), x.m]), [[old, 3, 12]]);
  const [au]: any = await pool().query("SELECT tenant_id, actor_id, entity_id, detail FROM audit_events WHERE action='evidence.archived'"); assert.equal(au.length, 1); assert.equal(au[0].entity_id, old); assert.equal(au[0].actor_id, null); assert.equal(au[0].tenant_id, T);
  assert.equal(await archiveDue(pool()), 0, 'running again changes nothing'); assert.equal((await archived()).length, 1);
  assert.equal(Number(((await pool().query('SELECT COUNT(*) n FROM evidence_requests'))[0] as any)[0].n) >= 6, true, 'no evidence is removed');
});
test('an organization-wide legal hold stops archival; releasing it lets the schedule continue', async () => {
  const e = await eng({ closedMonthsAgo: 30 }); await pool().query('UPDATE organizations SET legal_hold=1 WHERE id=?', [T]); assert.equal(await archiveDue(pool()), 0);
  await pool().query('UPDATE organizations SET legal_hold=0 WHERE id=?', [T]); assert.equal(await archiveDue(pool()), 1); assert.ok((await archived()).some(x => x.id === e));
});
test('a restored engagement is never archived again automatically', async () => {
  const e = await eng({ closedMonthsAgo: 40 }); assert.equal(await archiveDue(pool()), 1); await pool().query('UPDATE evidence_archive SET restored_at=NOW(3) WHERE engagement_id=?', [e]); assert.equal(await archiveDue(pool()), 0);
});
test('a batch limit keeps one run small', async () => { for (let i = 0; i < 3; i++) await eng({ closedMonthsAgo: 50 }); assert.equal(await archiveDue(pool(), 2), 2); assert.equal(await archiveDue(pool(), 2), 1); });
