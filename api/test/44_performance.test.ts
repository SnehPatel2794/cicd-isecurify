// Performance at scale (Phase 10H): 50,000 checklist items in one organization, 10 engagements, with findings, evidence requests, risks and incidents.
// Prints a table of measured response times (median and slowest of 3 requests, after one warm-up) and fails when a screen exceeds its budget.
// Budgets are deliberately generous (a busy shared CI machine runs this); docs/PERFORMANCE.md records the real numbers from a quiet run.
import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import { freshEnv, world } from './helpers'; import { refreshDue } from '../../worker/src/summaries';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let aAdmin: any, vendor: any, team: any; const ENGS = 10, PER = 5000; const engIds: string[] = [];
const A = (p: string) => `/t/${w.A}${p}`; const rows: { name: string; median: number; max: number; budget: number }[] = []; let seeded = 0;
const timeIt = async (name: string, budget: number, c: any, path: string, check?: (b: any) => void) => {
  await c.call('GET', path); const ms: number[] = []; let body: any;
  for (let i = 0; i < 3; i++) { const t0 = performance.now(); const r = await c.call('GET', path); ms.push(performance.now() - t0); assert.equal(r.status, 200, `${name}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); body = r.body; }
  ms.sort((a, b) => a - b); rows.push({ name, median: Math.round(ms[1]), max: Math.round(ms[2]), budget }); check?.(body); assert.ok(ms[2] <= budget, `${name} took ${Math.round(ms[2])} ms (budget ${budget} ms)`);
};
before(async () => {
  env = await freshEnv({ requireMfaForPlatform: false } as any); w = await world(env); aAdmin = await w.as('aAdmin'); vendor = await w.as('aVendor');
  await w.root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true, canReadEvidence: true }); team = await env.login('team@x.test');
  const q = (sql: string, p: any[] = []) => env.pool.query(sql, p) as Promise<any>; const t0 = performance.now();
  for (let e = 0; e < ENGS; e++) { const id = (await q('SELECT UUID() u'))[0][0].u as string; engIds.push(id); await q("INSERT INTO engagements(tenant_id,id,name,status,created_by,current_phase) VALUES (?,?,?,?,?,3)", [w.A, id, `Perf engagement ${e + 1}`, e === 9 ? 'closed' : 'active', w.ids.aAdmin]);
    for (let b = 0; b < PER; b += 1000) { const vals: any[] = []; const ph: string[] = [];
      for (let i = b + 1; i <= b + 1000; i++) { const r = ['not_started', 'in_progress', 'partially_implemented', 'implemented', 'implemented', 'implemented', 'not_applicable'][i % 7]; const ev = r === 'implemented' ? ['accepted', 'submitted', 'rejected', 'requested', 'in_progress'][i % 5] : 'not_requested';
        ph.push("(?,UUID(),?,'custom',?,?,?,?,?,?,?,?,?)"); vals.push(w.A, id, `P-${i}`, `Domain ${i % 12}`, `Control ${i} access and monitoring requirement`, r, ev, i % 25 === 0 ? w.ids.aVendor : null, i % 3 === 0 ? `2026-0${1 + (i % 9)}-15` : null, i, r === 'not_applicable' ? 'Out of scope' : null); }
      await q(`INSERT INTO checklist_items(tenant_id,id,engagement_id,origin,ref,domain,title,readiness_status,evidence_status,accountable_user_id,due_date,sort_order,na_justification) VALUES ${ph.join(',')}`, vals); }
  }
  await q("INSERT INTO findings(tenant_id,id,engagement_id,item_id,finding_no,title,description,severity,status,raised_by,due_date) SELECT tenant_id,UUID(),engagement_id,id,sort_order,'Perf finding','d',ELT(1+MOD(FLOOR(sort_order/100),3),'critical','high','low'),'open',?,IF(MOD(sort_order,200)=0,'2026-01-01',NULL) FROM checklist_items WHERE tenant_id=? AND MOD(sort_order,100)=0".replace('DIV_OR(sort_order)', 'FLOOR(sort_order/100)'), [w.ids.aAdmin, w.A]);
  await q("INSERT INTO evidence_requests(tenant_id,id,engagement_id,item_id,title,requested_by) SELECT tenant_id,UUID(),engagement_id,id,'Perf evidence',? FROM checklist_items WHERE tenant_id=? AND MOD(sort_order,25)=0", [w.ids.aAdmin, w.A]);
  for (let i = 1; i <= 500; i++) { await q("INSERT INTO risks(tenant_id,id,risk_no,title,description,category,likelihood,impact,status,created_by) VALUES (?,UUID(),?,?,?,'security',3,3,?,?)", [w.A, i, `Perf risk ${i}`, 'd', i % 4 === 0 ? 'closed' : 'identified', w.ids.aAdmin]).catch(() => {}); }
  for (const t of ['checklist_items', 'findings', 'evidence_requests', 'checklist_item_controls', 'soa_entries', 'engagements', 'risks']) await q(`ANALYZE TABLE ${t}`);   // what InnoDB's automatic statistics refresh does within minutes of a bulk load
  seeded = Math.round(performance.now() - t0); rows.push({ name: '(seeding 50,000 items + related rows)', median: seeded, max: seeded, budget: 0 });
}); after(async () => { console.log('\nPERFORMANCE (ms)\n' + rows.map(r => `${r.name.padEnd(46)} median ${String(r.median).padStart(5)}   slowest ${String(r.max).padStart(5)}   budget ${r.budget || '-'}`).join('\n')); fs.writeFileSync(process.env.PERF_OUT ?? '/tmp/perf-results.json', JSON.stringify(rows, null, 1)); if (process.env.PERF_KEEP) console.log('KEPT DATABASE ' + env.name); else await env.close(); });

test('the data set is really 50,000 checklist items', async () => { const n = (await env.pool.query('SELECT COUNT(*) n FROM checklist_items WHERE tenant_id=?', [w.A]) as any)[0][0].n; assert.equal(Number(n), ENGS * PER); });
test('the worker builds all summaries quickly', async () => { await env.pool.query('UPDATE summary_dirty SET marked_at=DATE_SUB(marked_at, INTERVAL 10 SECOND)'); const t0 = performance.now(); const n = await refreshDue(env.pool as any, { limit: 200 }); const ms = Math.round(performance.now() - t0); rows.push({ name: 'worker: compute 10 engagement summaries', median: ms, max: ms, budget: 30000 }); assert.equal(n, ENGS); assert.ok(ms < 30000); });
test('overview screens', async () => {
  await timeIt('dashboard (summaries)', 1500, aAdmin, A('/dashboard'), b => assert.equal(b.summary.total, 9 * PER)); await timeIt('engagement list (summaries)', 1500, aAdmin, A('/engagements'), b => assert.equal(b.length, ENGS));
  await timeIt('portfolio overview', 3000, team, '/platform/analytics'); await timeIt('analytics (6 months)', 8000, aAdmin, A('/analytics'));
});
test('tiles', async () => { for (const id of ['readiness', 'items-overdue', 'items-awaiting-review', 'findings-unresolved', 'findings-overdue', 'findings-critical', 'risks-open', 'incidents-open', 'my-work']) await timeIt(`tile ${id}`, id === 'my-work' ? 4000 : 1000, aAdmin, A(`/widgets/${id}`)); });
test('item list and drill-down', async () => {
  await timeIt('items: first page', 3000, aAdmin, A('/items'), b => assert.equal(b.total, 9 * PER - 0 + 0)); await timeIt('items: overdue', 3000, aAdmin, A('/items?overdue=true'));
  await timeIt('items: awaiting review', 3000, aAdmin, A('/items?state=awaiting_review'), b => assert.ok(b.total > 0)); await timeIt('items: text filter', 3000, aAdmin, A('/items?q=P-4999')); await timeIt('items: page 100', 3000, aAdmin, A('/items?page=100&pageSize=50'));
  await timeIt('items: vendor (own only)', 2000, vendor, A('/items'), b => assert.equal(b.total, 9 * (PER / 25)));
});
test('search, My Work, activity, findings', async () => {
  await timeIt('search "perf"', 4000, aAdmin, A('/search?q=perf')); await timeIt('search across organizations', 4000, aAdmin, '/me/search?q=access'); await timeIt('my work (vendor, 1,800 assigned items)', 5000, vendor, '/me/work'); await timeIt('activity timeline', 1500, aAdmin, A('/timeline'));
  await timeIt('findings list', 2500, aAdmin, A('/findings')); await timeIt('risk register', 2500, aAdmin, A('/risks'));
});
