import { test, before, after } from 'node:test'; import assert from 'node:assert/strict';
import { freshEnv, world, frameworkFixtures } from './helpers'; import { cleanTerm, likeOf, hit, rank, snippet, humanize } from '../src/modules/spog/rules';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let fx: Awaited<ReturnType<typeof frameworkFixtures>>; let aAdmin: any, bAdmin: any, vendor: any, staff: any, auditor: any, team: any, root: any; let E: string, E2: string, EB: string, ITEMS: any[], FIND: string;
const A = (p: string) => `/t/${w.A}${p}`; const B = (p: string) => `/t/${w.B}${p}`; const S = (c: any, q: string, org = A) => c.call('GET', org(`/search?q=${encodeURIComponent(q)}`));
const types = (r: any) => r.body.groups.map((g: any) => g.type); const all = (r: any) => r.body.groups.flatMap((g: any) => g.results);
before(async () => {
  env = await freshEnv({ requireMfaForPlatform: false } as any); w = await world(env); root = w.root; fx = await frameworkFixtures(root);
  await root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true, canReadEvidence: true }); team = await env.login('team@x.test');
  aAdmin = await w.as('aAdmin'); bAdmin = await w.as('bAdmin'); vendor = await w.as('aVendor'); staff = await w.as('aStaff'); auditor = await w.as('aAuditor');
  E = (await aAdmin.call('POST', A('/engagements'), { name: 'Quokka Audit', primaryReleaseId: fx.X.releaseId })).body.id; E2 = (await aAdmin.call('POST', A('/engagements'), { name: 'Second Programme', primaryReleaseId: fx.X.releaseId })).body.id;
  EB = (await bAdmin.call('POST', B('/engagements'), { name: 'Zeppelin Audit', primaryReleaseId: fx.X.releaseId })).body.id;
  ITEMS = (await aAdmin.call('GET', A(`/engagements/${E}/checklist`))).body.items; await aAdmin.call('PATCH', A(`/checklist/${ITEMS[0].id}`), { accountableUserId: w.ids.aVendor });
  await env.pool.query("UPDATE checklist_items SET title='Quokka access review' WHERE tenant_id=? AND id IN (?,?)", [w.A, ITEMS[0].id, ITEMS[1].id]);
  await env.pool.query("UPDATE checklist_items SET title='Zeppelin secret item' WHERE tenant_id=? AND id=(SELECT id FROM (SELECT id FROM checklist_items WHERE tenant_id=? AND engagement_id=? LIMIT 1) x)", [w.B, w.B, EB]);
  FIND = (await team.call('POST', A(`/checklist/${ITEMS[0].id}/findings`), { title: 'Quokka weak password policy', description: 'Passwords can be guessed by a quokka', severity: 'high' })).body.id;
  await aAdmin.call('POST', A('/risks'), { title: 'Quokka outbreak risk', description: 'Quokkas escaping', category: 'security', likelihood: 3, impact: 3 }); await env.pool.query('UPDATE risks SET owner_user_id=? WHERE tenant_id=?', [w.ids.aAdmin, w.A]);
  await staff.call('POST', A('/incidents'), { title: 'Quokka seen near server room', description: 'sighting', category: 'security_breach', severity: 'low' }); await aAdmin.call('POST', A('/incidents'), { title: 'Quokka admin-only incident', description: 'x', category: 'security_breach', severity: 'low' });
  await aAdmin.call('POST', A('/vendors'), { name: 'Quokka Hosting', service: 'Hosts quokkas', category: 'cloud', criticality: 'critical', dataAccess: 'personal' });
  await aAdmin.call('POST', A('/policies'), { title: 'Quokka handling policy', category: 'security', body: 'Be kind to quokkas.' });
  await bAdmin.call('POST', B('/risks'), { title: 'Zeppelin risk', description: 'd', category: 'security', likelihood: 3, impact: 3 });
}); after(() => env.close());

test('pure: term cleaning, LIKE escaping, matching, ranking, snippets, wording', () => {
  assert.equal(cleanTerm(' a '), null); assert.equal(cleanTerm('  ab  '), 'ab'); assert.equal(cleanTerm('a\u0000b\n c'), 'a b c'); assert.equal(cleanTerm('x'.repeat(200))!.length, 80); assert.equal(cleanTerm(undefined), null);
  assert.equal(likeOf('50%_off!'), '%50!%!_off!!%'); assert.equal(hit('QUO', 'a quokka'), true); assert.equal(hit('zz', 'a', null, undefined), false);
  assert.equal(rank('f-001', 'F-001', 'x'), 0); assert.equal(rank('qu', 'R1', 'Quokka'), 1); assert.equal(rank('kk', 'R1', 'Quokka'), 2); assert.equal(rank('zz', 'R1', 'Quokka'), 3);
  assert.equal(snippet('The quick brown fox jumps over the lazy dog and keeps running far away', 'fox', 20), '…ick brown fox jumps ove…'); assert.equal(snippet('abc', 'zzz'), null); assert.equal(snippet(null, 'a'), null);
  assert.equal(humanize('engagement.created'), 'Engagement created'); assert.equal(humanize('export.risks'), 'Export risks');
});
test('search: too short is refused, signed-out is refused, another organization is a 404', async () => {
  assert.equal((await S(aAdmin, 'q')).status, 400); assert.equal((await S(aAdmin, '')).status, 400); assert.equal((await env.client().call('GET', A('/search?q=quokka'))).status, 401); assert.equal((await S(bAdmin, 'quokka')).status, 404);
});
test('a client admin finds engagements, checklist items, findings, risks, incidents, vendors and policies, best matches first, with snippets and links', async () => {
  const r = await S(aAdmin, 'quokka'); assert.equal(r.status, 200); assert.deepEqual(types(r), ['engagement', 'item', 'finding', 'risk', 'incident', 'vendor', 'policy']);
  const item = r.body.groups.find((g: any) => g.type === 'item').results; assert.equal(item.length, 2); assert.ok(item[0].path.startsWith(`/org/${w.A}/engagements/${E}`)); const f = all(r).find((x: any) => x.type === 'finding'); assert.equal(f.id, FIND); assert.match(f.snippet, /quokka/i); assert.equal(f.ref, 'F-001'); assert.equal(f.engagementName, 'Quokka Audit');
  assert.equal(all(r).filter((x: any) => x.type === 'incident').length, 2, 'admin sees every incident');
});
test('LEAK: nothing from another organization, ever, in either direction', async () => {
  const a = await S(aAdmin, 'zeppelin'); assert.deepEqual(a.body.groups, []); const b = await S(bAdmin, 'zeppelin', B); assert.deepEqual(types(b), ['engagement', 'item', 'risk']); assert.deepEqual((await S(bAdmin, 'quokka', B)).body.groups, []);
  assert.equal(JSON.stringify((await S(aAdmin, 'quokka')).body).includes('Zeppelin'), false);
});
test('LEAK: a vendor sees only the item assigned to them (and its finding), never other items, risks, incidents, vendors, drafts or other people\'s work', async () => {
  const r = await S(vendor, 'quokka'); const got = all(r); assert.deepEqual([...new Set(got.map((x: any) => x.type))].sort(), ['engagement', 'finding', 'item']); assert.deepEqual(got.filter((x: any) => x.type === 'item').map((x: any) => x.id), [ITEMS[0].id]);
  assert.equal(got.filter((x: any) => x.type === 'engagement').length, 1); assert.equal((await S(vendor, 'Second Programme')).body.groups.length, 0, 'an engagement with none of their items is invisible');
});
test('LEAK: client staff see only their own incident; auditors see all of the register but only engagements they belong to', async () => {
  const s = await S(staff, 'quokka'); assert.deepEqual(all(s).filter((x: any) => x.type === 'incident').map((x: any) => x.title), ['Quokka seen near server room']); assert.equal(all(s).some((x: any) => ['risk', 'vendor', 'policy', 'item', 'finding', 'engagement'].includes(x.type)), false);
  const a = await S(auditor, 'quokka'); assert.equal(all(a).some((x: any) => x.type === 'engagement' || x.type === 'item' || x.type === 'finding'), false, 'not a member of the engagement yet'); assert.equal(all(a).filter((x: any) => x.type === 'risk').length, 1);
  await team.call('PUT', A(`/engagements/${E}/members/${w.ids.aAuditor}`), { role: 'auditor' }); assert.deepEqual([...new Set(all(await S(auditor, 'quokka')).map((x: any) => x.type))].includes('engagement'), true);
});
test('a draft policy is invisible to people who cannot read drafts; no counts or totals are returned beyond what is listed', async () => {
  assert.equal(all(await S(staff, 'quokka handling')).length, 0); assert.equal(all(await S(vendor, 'quokka handling')).length, 0); const body = (await S(vendor, 'quokka')).body; assert.deepEqual(Object.keys(body).sort(), ['groups', 'q']); for (const g of body.groups) assert.deepEqual(Object.keys(g).sort(), ['more', 'results', 'type']);
});
test('wildcards and injection strings are just text', async () => {
  for (const q of ['%%', '__', '%_', "' OR 1=1 --", '"; DROP TABLE users; --', '\\\\', '**']) { const r = await S(aAdmin, q); assert.equal(r.status, 200, q); assert.deepEqual(r.body.groups, [], q); }
  assert.equal((await env.pool.query('SELECT COUNT(*) n FROM users') as any)[0][0].n > 0, true);
});
test('filters: engagement, type, owner, status, limit', async () => {
  const e = await aAdmin.call('GET', A(`/search?q=quokka&engagementId=${E}`)); assert.deepEqual(types(e), ['engagement', 'item', 'finding'], 'engagement-bound types only'); assert.equal((await aAdmin.call('GET', A(`/search?q=quokka&engagementId=${E2}`))).body.groups.length, 0);
  assert.deepEqual(types(await aAdmin.call('GET', A('/search?q=quokka&type=risk'))), ['risk']); const o = await aAdmin.call('GET', A(`/search?q=quokka&ownerId=${w.ids.aVendor}`)); assert.deepEqual(all(o).map((x: any) => x.type).sort(), ['item']);
  assert.equal((await aAdmin.call('GET', A('/search?q=quokka&status=high'))).body.groups.length, 0); assert.equal((await aAdmin.call('GET', A('/search?q=quokka&type=item&limit=1'))).body.groups[0].more, true);
  assert.equal((await aAdmin.call('GET', A('/search?q=quokka&type=nonsense'))).status, 400); assert.equal((await aAdmin.call('GET', A('/search?q=quokka&engagementId=not-a-uuid'))).status, 400); assert.equal((await aAdmin.call('GET', A('/search?q=quokka&limit=999'))).status, 400);
  const fw = await aAdmin.call('GET', A(`/search?q=quokka&frameworkId=${fx.X.id}`)); assert.deepEqual(types(fw), ['engagement', 'item', 'finding']); assert.equal((await aAdmin.call('GET', A(`/search?q=quokka&frameworkId=${fx.Y.id}`))).body.groups.length, 0);
});
test('across organizations: only organizations the person can enter, each result labelled; the organization filter narrows it', async () => {
  assert.deepEqual((await vendor.call('GET', '/me/search?q=zeppelin')).body.groups, []); const s1 = await team.call('GET', '/me/search?q=quokka'); assert.ok(all(s1).every((x: any) => x.orgId === w.A && x.orgName === 'Org A'));
  await root.call('POST', `/platform/organizations/${w.B}/staff`, { userId: w.ids.team, canManage: false, canReadEvidence: false }); const both = await team.call('GET', '/me/search?q=audit'); assert.deepEqual([...new Set(all(both).map((x: any) => x.orgName))].sort(), ['Org A', 'Org B']);
  const onlyB = await team.call('GET', `/me/search?q=audit&orgId=${w.B}`); assert.deepEqual([...new Set(all(onlyB).map((x: any) => x.orgName))], ['Org B']); assert.equal((await team.call('GET', `/me/search?q=quokka&orgId=${w.B}`)).body.groups.length, 0);
  assert.equal((await env.client().call('GET', '/me/search?q=quokka')).status, 401);
});
test('My Work: assigned items, evidence to provide, my findings; only the person\'s own things', async () => {
  const rid = (await aAdmin.call('POST', A(`/checklist/${ITEMS[0].id}/evidence-requests`), { title: 'Access review export' })).body.id; assert.ok(rid);
  const v = (await vendor.call('GET', A('/my-work'))).body; const keys = v.sections.map((s: any) => s.key); assert.ok(keys.includes('items')); assert.ok(keys.includes('evidence')); assert.equal(v.sections.find((s: any) => s.key === 'items').entries[0].id, ITEMS[0].id); assert.equal(v.total, v.sections.reduce((n: number, s: any) => n + s.entries.length, 0));
  const adm = (await aAdmin.call('GET', A('/my-work'))).body; assert.equal(adm.sections.some((s: any) => s.key === 'items' || s.key === 'evidence'), false, 'nothing is assigned to the admin'); assert.equal(adm.sections.find((s: any) => s.key === 'risks').entries.length, 1);
  await env.pool.query('UPDATE findings SET owner_user_id=? WHERE id=?', [w.ids.aVendor, FIND]); const v2 = (await vendor.call('GET', A('/my-work'))).body; assert.equal(v2.sections.find((s: any) => s.key === 'findings').entries[0].ref, 'F-001'); assert.equal((await vendor.call('GET', B('/my-work'))).status, 404);
  assert.equal((await env.client().call('GET', A('/my-work'))).status, 401);
});
test('My Work: reviews waiting appear only for people who can review; a closed engagement\'s items are not listed', async () => {
  const [r] = (await env.pool.query("SELECT id FROM evidence_requests WHERE tenant_id=? LIMIT 1", [w.A]) as any)[0]; await env.pool.query("UPDATE evidence_requests SET status='submitted', latest_version_no=1 WHERE id=?", [r.id]);
  const aud = (await auditor.call('GET', A('/my-work'))).body; assert.equal(aud.sections.find((s: any) => s.key === 'review_evidence').entries.length, 1); assert.equal((await aAdmin.call('GET', A('/my-work'))).body.sections.some((s: any) => s.key === 'review_evidence'), false, 'client admins cannot review evidence');
  assert.equal((await vendor.call('GET', A('/my-work'))).body.sections.some((s: any) => s.key === 'review_evidence'), false); assert.ok((await team.call('GET', A('/my-work'))).body.sections.some((s: any) => s.key === 'review_retest') === false);
  await env.pool.query("UPDATE findings SET status='ready_for_retest' WHERE id=?", [FIND]); assert.equal((await auditor.call('GET', A('/my-work'))).body.sections.find((s: any) => s.key === 'review_retest').entries.length, 1);
  await env.pool.query("UPDATE engagements SET status='closed', closed_at=NOW(3) WHERE tenant_id=? AND id=?", [w.A, E]); assert.equal((await vendor.call('GET', A('/my-work'))).body.sections.some((s: any) => s.key === 'items'), false); await env.pool.query("UPDATE engagements SET status='active', closed_at=NULL WHERE tenant_id=? AND id=?", [w.A, E]);
});
test('My Work filters: engagement, period (by due date), status; bad values refused; across organizations', async () => {
  await env.pool.query("UPDATE checklist_items SET due_date='2020-01-05' WHERE id=?", [ITEMS[0].id]); const f = async (q: string) => (await vendor.call('GET', A('/my-work' + q))); const it = (r: any) => r.body.sections.find((s: any) => s.key === 'items');
  assert.equal(it(await f('')).entries[0].overdue, true); assert.ok(it(await f('?from=2020-01-01&to=2020-01-31'))); assert.equal(it(await f('?from=2021-01-01')), undefined, 'outside the period'); assert.equal(it(await f(`?engagementId=${E2}`)), undefined); assert.ok(it(await f(`?engagementId=${E}`)));
  assert.equal((await f('?from=2020-1-1')).status, 400); assert.equal((await f('?status=DROP TABLE')).status, 400);
  const me = (await vendor.call('GET', '/me/work')).body; assert.equal(me.organizations.length, 1); assert.equal(me.organizations[0].name, 'Org A'); assert.equal(me.total, me.organizations[0].total); assert.equal((await vendor.call('GET', `/me/work?orgId=${w.B}`)).body.organizations.length, 0);
});
test('timeline: administrators and auditors see the organization; others see only what they did; filters; no IP addresses', async () => {
  const adm = (await aAdmin.call('GET', A('/timeline'))).body; assert.equal(adm.scope, 'organization'); assert.ok(adm.items.length > 3); assert.ok(adm.items[0].label); assert.equal('ip' in adm.items[0], false); assert.ok(adm.items.every((x: any, i: number, a: any[]) => i === 0 || a[i - 1].id > x.id));
  const own = (await vendor.call('GET', A('/timeline'))).body; assert.equal(own.scope, 'mine'); assert.ok(own.items.every((x: any) => x.actor?.id === w.ids.aVendor)); assert.equal((await vendor.call('GET', A(`/timeline?ownerId=${w.ids.aAdmin}`))).body.items.length, 0);
  const byEng = (await aAdmin.call('GET', A(`/timeline?engagementId=${E}`))).body; assert.ok(byEng.items.length > 0 && byEng.items.every((x: any) => x.engagementId === E)); assert.equal((await aAdmin.call('GET', A(`/timeline?ownerId=${w.ids.aAdmin}`))).body.items.every((x: any) => x.actor.id === w.ids.aAdmin), true);
  assert.equal((await aAdmin.call('GET', A('/timeline?from=2000-01-01&to=2000-01-02'))).body.items.length, 0); const p1 = (await aAdmin.call('GET', A('/timeline?limit=2'))).body; assert.equal(p1.items.length, 2); assert.ok(p1.nextBeforeId); const p2 = (await aAdmin.call('GET', A(`/timeline?limit=2&beforeId=${p1.nextBeforeId}`))).body; assert.ok(p2.items[0].id < p1.items[1].id);
  assert.equal((await aAdmin.call('GET', A('/timeline?entity=engagement'))).body.items.every((x: any) => x.entity === 'engagement'), true); assert.equal((await bAdmin.call('GET', A('/timeline'))).status, 404); assert.equal((await aAdmin.call('GET', A('/timeline?limit=500'))).status, 400);
  assert.equal(JSON.stringify((await aAdmin.call('GET', A('/timeline'))).body).includes(w.B), false, 'nothing from another organization');
});
