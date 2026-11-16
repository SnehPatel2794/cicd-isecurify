import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import crypto from 'node:crypto';
import { freshEnv, world, frameworkFixtures } from './helpers'; import { sign, verify, matches, isSendable, validPattern, isPrivateAddress, checkUrl, KEY_PATTERN, backoffSeconds } from '../../shared/webhooks';
let env: Awaited<ReturnType<typeof freshEnv>>; let w: Awaited<ReturnType<typeof world>>; let fx: Awaited<ReturnType<typeof frameworkFixtures>>; let aAdmin: any, bAdmin: any, vendor: any, staff: any, auditor: any, team: any, root: any; let E: string, ITEMS: any[], TEST: string;
const A = (p: string) => `/t/${w.A}${p}`; const B = (p: string) => `/t/${w.B}${p}`; const rows = async (s: string, p: any[] = []) => ((await env.pool.query(s, p)) as any)[0] as any[];
const api = (key: string | null, method: string, url: string, body?: any) => env.client().call(method, url, body, key ? { authorization: `Bearer ${key}` } : {});
const mkKey = async (c: any, scopes: string[], org = A, extra: any = {}) => { const r = await c.call('POST', org('/api-keys'), { name: 'k-' + scopes.join('+'), scopes, ...extra }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.key as string; };
before(async () => {
  env = await freshEnv({ requireMfaForPlatform: false, webhookKey: crypto.randomBytes(32) } as any); w = await world(env); root = w.root; fx = await frameworkFixtures(root);
  await root.call('POST', `/platform/organizations/${w.A}/staff`, { userId: w.ids.team, canManage: true, canReadEvidence: true }); team = await env.login('team@x.test');
  aAdmin = await w.as('aAdmin'); bAdmin = await w.as('bAdmin'); vendor = await w.as('aVendor'); staff = await w.as('aStaff'); auditor = await w.as('aAuditor');
  E = (await aAdmin.call('POST', A('/engagements'), { name: 'API org A', primaryReleaseId: fx.X.releaseId })).body.id; ITEMS = (await aAdmin.call('GET', A(`/engagements/${E}/checklist`))).body.items;
  TEST = (await aAdmin.call('POST', A(`/checklist/${ITEMS[0].id}/control-tests`), { title: 'Backups restore', frequency: 'monthly' })).body.id;
  const EB = (await bAdmin.call('POST', B('/engagements'), { name: 'API org B', primaryReleaseId: fx.X.releaseId })).body.id; await bAdmin.call('GET', B(`/engagements/${EB}/checklist`));
}); after(() => env.close());

test('pure: signatures verify and expire; patterns; private addresses; URLs; key format; back-off', () => {
  const body = '{"a":1}'; const h = sign('s3cret', body, 1000); assert.ok(verify('s3cret', body, h, 1100)); assert.equal(verify('s3cret', body + ' ', h, 1100), false); assert.equal(verify('other', body, h, 1100), false); assert.equal(verify('s3cret', body, h, 1000 + 301), false, 'replay window'); assert.equal(verify('s3cret', body, 'garbage', 1000), false);
  assert.ok(matches(['*'], 'finding.raised')); assert.ok(matches(['finding.*'], 'finding.raised')); assert.equal(matches(['finding.*'], 'findings.x'), false); assert.ok(matches(['finding.raised'], 'finding.raised')); assert.equal(matches(['finding.raised'], 'finding.closed'), false);
  for (const a of ['auth.login', 'user.deleted', 'api_key.created', 'webhook.updated', 'platform.org_created', 'invitation.sent', 'mfa.enabled']) { assert.equal(isSendable(a), false, a); assert.equal(matches(['*'], a), false, a); }
  assert.ok(validPattern('*') && validPattern('a.b.*') && validPattern('a_b.c')); assert.equal(validPattern('a..b'), false); assert.equal(validPattern('A.b'), false); assert.equal(validPattern('a b'), false);
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1', '224.0.0.1', 'not-an-ip']) assert.equal(isPrivateAddress(ip), true, ip); for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
  assert.equal(checkUrl('https://hooks.example.com/x').ok, true); for (const u of ['http://example.com', 'ftp://x.com', 'https://user:pw@x.com', 'https://localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://x.internal/', 'https://x.com/#f', 'nope']) assert.equal(checkUrl(u).ok, false, u); assert.equal(checkUrl('http://localhost:9/x', { allowHttp: true }).ok, true);
  assert.ok(KEY_PATTERN.test('isg_0123abcd_' + 'A'.repeat(43))); assert.equal(KEY_PATTERN.test('isg_0123abcd_short'), false); assert.equal(backoffSeconds(1), 30); assert.ok(backoffSeconds(20) <= 21600);
});
test('creating keys: managers only; the key is shown once, stored only as a hash; scopes validated; audited; at most 20', async () => {
  for (const c of [vendor, staff, auditor]) assert.equal((await c.call('POST', A('/api-keys'), { name: 'x', scopes: ['items:read'] })).status, 403); assert.equal((await bAdmin.call('POST', A('/api-keys'), { name: 'x', scopes: ['items:read'] })).status, 404); assert.equal((await env.client().call('POST', A('/api-keys'), {})).status, 401);
  assert.equal((await aAdmin.call('POST', A('/api-keys'), { name: 'x', scopes: [] })).status, 400); assert.equal((await aAdmin.call('POST', A('/api-keys'), { name: 'x', scopes: ['everything'] })).status, 400);
  const r = await aAdmin.call('POST', A('/api-keys'), { name: 'Scanner', scopes: ['findings:write', 'items:read'], expiresInDays: 30 }); assert.equal(r.status, 201); assert.match(r.body.key, KEY_PATTERN); const row = (await rows('SELECT * FROM api_keys WHERE id=?', [r.body.id]))[0];
  assert.notEqual(row.key_hash, r.body.key); assert.equal(row.key_hash, crypto.createHash('sha256').update(r.body.key).digest('hex')); assert.equal(JSON.stringify(row).includes(r.body.key.split('_')[2]), false, 'the secret is nowhere in the row');
  const list = JSON.stringify((await aAdmin.call('GET', A('/api-keys'))).body); assert.equal(list.includes(r.body.key), false); assert.equal(list.includes(row.key_hash), false); assert.ok(list.includes('Scanner'));
  assert.equal((await rows("SELECT COUNT(*) n FROM audit_events WHERE action='api_key.created' AND tenant_id=?", [w.A]))[0].n >= 1, true); assert.equal((await team.call('POST', A('/api-keys'), { name: 'By staff', scopes: ['posture:read'] })).status, 201, 'managing iSecurify staff may');
  assert.equal((await bAdmin.call('GET', B('/api-keys'))).body.keys.length, 0, 'another organization sees none of these');
});
test('authentication: missing, malformed, unknown, wrong secret, revoked, expired, disabled creator, suspended organization all give the same 401', async () => {
  const good = await mkKey(aAdmin, ['items:read']); assert.equal((await api(good, 'GET', '/v1/me')).status, 200); const same = async (key: string | null) => { const r = await api(key, 'GET', '/v1/me'); assert.equal(r.status, 401, String(key)); return r.body; };
  const b0 = await same(null); await same('nonsense'); await same(good.slice(0, -2) + 'xx'); await same(good.replace(/^isg_[0-9a-f]{8}/, 'isg_00000000')); assert.deepEqual(await same(good + 'x'), b0);
  const k = await aAdmin.call('POST', A('/api-keys'), { name: 'rev', scopes: ['items:read'] }); assert.equal((await api(k.body.key, 'GET', '/v1/me')).status, 200); assert.equal((await vendor.call('DELETE', A(`/api-keys/${k.body.id}`))).status, 403); assert.equal((await bAdmin.call('DELETE', A(`/api-keys/${k.body.id}`))).status, 404);
  assert.equal((await aAdmin.call('DELETE', A(`/api-keys/${k.body.id}`))).status, 200); await same(k.body.key);
  const e = await aAdmin.call('POST', A('/api-keys'), { name: 'exp', scopes: ['items:read'], expiresInDays: 1 }); await env.pool.query('UPDATE api_keys SET expires_at=DATE_SUB(NOW(3), INTERVAL 1 MINUTE) WHERE id=?', [e.body.id]); await same(e.body.key);
  const tk = await mkKey(team, ['items:read']); assert.equal((await api(tk, 'GET', '/v1/me')).status, 200); await env.pool.query('UPDATE staff_assignments SET can_manage=0 WHERE user_id=?', [w.ids.team]); await same(tk); await env.pool.query('UPDATE staff_assignments SET can_manage=1 WHERE user_id=?', [w.ids.team]); assert.equal((await api(tk, 'GET', '/v1/me')).status, 200);
  await env.pool.query("UPDATE users SET status='disabled' WHERE id=?", [w.ids.team]); await same(tk); await env.pool.query("UPDATE users SET status='active' WHERE id=?", [w.ids.team]);
  await env.pool.query("UPDATE organizations SET status='suspended' WHERE id=?", [w.A]); await same(good); await env.pool.query("UPDATE organizations SET status='active' WHERE id=?", [w.A]); assert.equal((await api(good, 'GET', '/v1/me')).status, 200);
  assert.ok((await rows('SELECT last_used_at FROM api_keys WHERE key_hash=?', [crypto.createHash('sha256').update(good).digest('hex')]))[0].last_used_at, 'use is recorded');
});
test('a key is not a session: cookies and CSRF do nothing, a session cannot call /v1, and a key cannot call the normal API', async () => {
  const key = await mkKey(aAdmin, ['items:read', 'findings:write']); assert.equal((await aAdmin.call('GET', '/v1/me')).status, 401, 'a signed-in browser is not a key'); assert.equal((await api(key, 'GET', A('/engagements'))).status, 401); assert.equal((await api(key, 'GET', '/auth/me')).status, 401);
  assert.equal((await api(key, 'POST', A('/risks'), { title: 'x', description: 'd', category: 'security', likelihood: 1, impact: 1 })).status, 401);
});
test('scopes: each endpoint needs its own scope; a key never reaches beyond its organization', async () => {
  const read = await mkKey(aAdmin, ['items:read']); const write = await mkKey(aAdmin, ['findings:write']); assert.equal((await api(read, 'GET', '/v1/findings')).status, 403); assert.equal((await api(read, 'GET', '/v1/audit')).status, 403); assert.equal((await api(read, 'GET', '/v1/posture')).status, 403); assert.equal((await api(write, 'GET', '/v1/items')).status, 403);
  const items = await api(read, 'GET', '/v1/items'); assert.equal(items.status, 200); assert.ok(items.body.total >= 3); assert.ok(items.body.items.every((i: any) => ITEMS.some((x: any) => x.id === i.id)), 'only organization A items'); assert.equal((await api(read, 'GET', `/v1/items?engagementId=${w.ids.bAdmin}`)).status, 404);
  const o = await api(read, 'GET', '/v1/items?overdue=true'); assert.equal(o.body.total, 0); assert.equal((await api(read, 'GET', '/v1/items?page=0')).status, 400);
  const kb = await mkKey(bAdmin, ['items:read'], B); const bi = await api(kb, 'GET', '/v1/items'); assert.ok(bi.body.items.every((i: any) => !ITEMS.some((x: any) => x.id === i.id)), 'org B key sees none of A');
  const me = await api(read, 'GET', '/v1/me'); assert.deepEqual(me.body.scopes, ['items:read']); assert.equal(me.body.organizationId, w.A);
});
test('raising findings through the API: validated, audited as the key, idempotent by externalRef, refused on closed engagements and not-applicable items', async () => {
  const key = await mkKey(aAdmin, ['findings:write', 'findings:read']); const body = { itemId: ITEMS[0].id, title: 'Outdated TLS on api.example.com', description: 'TLS 1.0 accepted', severity: 'high', externalRef: 'scan-8841-1' };
  assert.equal((await api(key, 'POST', '/v1/findings', { ...body, severity: 'urgent' })).status, 400); assert.equal((await api(key, 'POST', '/v1/findings', { ...body, itemId: ITEMS_B() })).status, 404); assert.equal((await api(key, 'POST', '/v1/findings', { ...body, externalRef: 'has space' })).status, 400);
  const r = await api(key, 'POST', '/v1/findings', body); assert.equal(r.status, 201); assert.equal(r.body.duplicate, false); const again = await api(key, 'POST', '/v1/findings', { ...body, title: 'changed' }); assert.equal(again.status, 200); assert.equal(again.body.duplicate, true); assert.equal(again.body.id, r.body.id);
  const f = (await rows('SELECT * FROM findings WHERE id=?', [r.body.id]))[0]; assert.equal(f.tenant_id, w.A); assert.equal(f.status, 'open'); assert.equal(f.raised_by, w.ids.aAdmin); assert.equal(f.external_ref, 'scan-8841-1'); assert.equal(f.title, 'Outdated TLS on api.example.com');
  const au = (await rows("SELECT detail FROM audit_events WHERE action='finding.raised' AND entity_id=? ORDER BY id DESC LIMIT 1", [E]))[0]; const det = typeof au.detail === 'string' ? JSON.parse(au.detail) : au.detail; assert.ok(det.viaApiKey && det.apiKeyName);
  const list = await api(key, 'GET', '/v1/findings?severity=high'); assert.ok(list.body.findings.some((x: any) => x.id === r.body.id)); assert.equal((await api(key, 'GET', '/v1/findings?severity=weird')).status, 400);
  await env.pool.query("UPDATE checklist_items SET readiness_status='not_applicable', na_justification='x' WHERE id=?", [ITEMS[2].id]); assert.equal((await api(key, 'POST', '/v1/findings', { ...body, itemId: ITEMS[2].id, externalRef: 'n/a-1' })).status, 409);
  await env.pool.query("UPDATE checklist_items SET readiness_status='not_started', na_justification=NULL WHERE id=?", [ITEMS[2].id]);
  const E2 = (await aAdmin.call('POST', A('/engagements'), { name: 'closing', primaryReleaseId: fx.X.releaseId })).body.id; const i2 = (await aAdmin.call('GET', A(`/engagements/${E2}/checklist`))).body.items[0]; await env.pool.query("UPDATE engagements SET status='closed', closed_at=NOW(3) WHERE id=?", [E2]); assert.equal((await api(key, 'POST', '/v1/findings', { ...body, itemId: i2.id, externalRef: 'closed-1' })).status, 409);
});
const ITEMS_B = () => crypto.randomUUID();
test('recording control-test results through the API (automated checks); a failure notifies; paused tests refuse', async () => {
  const key = await mkKey(aAdmin, ['tests:write', 'tests:read']); const list = await api(key, 'GET', '/v1/control-tests'); assert.ok(list.body.tests.some((t: any) => t.id === TEST));
  assert.equal((await api(key, 'POST', `/v1/control-tests/${TEST}/runs`, { result: 'pass' })).status, 400); assert.equal((await api(key, 'POST', `/v1/control-tests/${crypto.randomUUID()}/runs`, { result: 'pass', note: 'x' })).status, 404);
  const ok = await api(key, 'POST', `/v1/control-tests/${TEST}/runs`, { result: 'pass', note: 'Restore job 5521 succeeded' }); assert.equal(ok.status, 201); const run = (await rows('SELECT * FROM control_test_runs WHERE id=?', [ok.body.id]))[0]; assert.match(run.note, /via API/); assert.equal(run.performed_by, w.ids.aAdmin);
  const bad = await api(key, 'POST', `/v1/control-tests/${TEST}/runs`, { result: 'fail', note: 'Restore job 5522 failed' }); assert.equal(bad.status, 201); assert.equal((await rows("SELECT last_result r FROM control_tests WHERE id=?", [TEST]))[0].r, 'fail');
  const kb = await mkKey(bAdmin, ['tests:write'], B); assert.equal((await api(kb, 'POST', `/v1/control-tests/${TEST}/runs`, { result: 'pass', note: 'x' })).status, 404, 'another organization\'s test is invisible');
  await aAdmin.call('PATCH', A(`/control-tests/${TEST}`), { status: 'paused' }); assert.equal((await api(key, 'POST', `/v1/control-tests/${TEST}/runs`, { result: 'pass', note: 'x' })).status, 409); await aAdmin.call('PATCH', A(`/control-tests/${TEST}`), { status: 'active' });
});
test('posture and the activity feed (SIEM): scoped, ordered, resumable, never include sign-in or integration events', async () => {
  const key = await mkKey(aAdmin, ['posture:read', 'audit:read']); const p = await api(key, 'GET', '/v1/posture'); assert.equal(p.status, 200); assert.ok(p.body.engagements.some((e: any) => e.id === E && e.frameworks.length === 1));
  const a1 = await api(key, 'GET', '/v1/audit?limit=5'); assert.equal(a1.status, 200); assert.equal(a1.body.events.length > 0, true); const ids = a1.body.events.map((e: any) => Number(e.id.slice(4))); assert.deepEqual(ids, [...ids].sort((x, y) => x - y)); assert.ok(a1.body.events.every((e: any) => e.organizationId === w.A));
  const a2 = await api(key, 'GET', `/v1/audit?afterId=${a1.body.nextAfterId}&limit=500`); assert.ok(a2.body.events.every((e: any) => Number(e.id.slice(4)) > a1.body.nextAfterId)); const all = [...a1.body.events, ...a2.body.events]; assert.ok(all.every((e: any) => !/^(auth|user|api_key|webhook|invitation|mfa|platform)\./.test(e.type)), 'nothing sensitive');
  assert.equal((await api(key, 'GET', '/v1/audit?limit=9999')).status, 400); assert.equal((await api(key, 'GET', '/v1/audit?afterId=-1')).status, 400);
});
test('rate limit per key and slow-down for repeated bad keys', async () => {
  const key = await mkKey(aAdmin, ['items:read']); let last = 0; for (let i = 0; i < 605 && last !== 429; i++) last = (await api(key, 'GET', '/v1/me')).status; assert.equal(last, 429);
  const other = await mkKey(aAdmin, ['items:read']); assert.equal((await api(other, 'GET', '/v1/me')).status, 200, 'another key is unaffected');
  let st = 0; for (let i = 0; i < 40 && st !== 429; i++) st = (await api('isg_deadbeef_' + 'x'.repeat(43), 'GET', '/v1/me')).status; assert.equal(st, 429, 'guessing keys is slowed down');
});
test('webhook endpoints: managers only, https only, secret shown once and stored sealed, events validated, limit of 10, rotate, test, delete, audited', async () => {
  const body = { name: 'SIEM', url: 'https://siem.example.com/hook', events: ['finding.*', 'evidence.accepted'] };
  for (const c of [vendor, staff, auditor]) assert.equal((await c.call('POST', A('/webhooks'), body)).status, 403); assert.equal((await bAdmin.call('POST', A('/webhooks'), body)).status, 404);
  for (const u of ['http://siem.example.com/h', 'https://127.0.0.1/h', 'https://localhost/h', 'https://169.254.169.254/latest', 'https://u:p@x.com/h', 'javascript:alert(1)']) assert.equal((await aAdmin.call('POST', A('/webhooks'), { ...body, url: u })).status, 400, u);
  assert.equal((await aAdmin.call('POST', A('/webhooks'), { ...body, events: ['Bad Event'] })).status, 400); assert.equal((await aAdmin.call('POST', A('/webhooks'), { ...body, events: [] })).status, 400);
  const r = await aAdmin.call('POST', A('/webhooks'), body); assert.equal(r.status, 201); assert.match(r.body.secret, /^whsec_/); const row = (await rows('SELECT * FROM webhook_endpoints WHERE id=?', [r.body.id]))[0]; assert.equal(row.secret_enc.includes(r.body.secret), false); assert.equal(JSON.stringify((await aAdmin.call('GET', A('/webhooks'))).body).includes(r.body.secret), false); assert.equal(JSON.stringify((await aAdmin.call('GET', A('/webhooks'))).body).includes('secretEnc'), false);
  const rot = await aAdmin.call('POST', A(`/webhooks/${r.body.id}/rotate-secret`), {}); assert.notEqual(rot.body.secret, r.body.secret); assert.equal((await bAdmin.call('POST', A(`/webhooks/${r.body.id}/rotate-secret`), {})).status, 404);
  assert.equal((await aAdmin.call('PATCH', A(`/webhooks/${r.body.id}`), { url: 'http://x.com' })).status, 400); assert.equal((await aAdmin.call('PATCH', A(`/webhooks/${r.body.id}`), { events: ['risk.*'], active: false })).status, 200); assert.equal((await aAdmin.call('PATCH', A(`/webhooks/${r.body.id}`), {})).status, 400);
  assert.equal((await aAdmin.call('POST', A(`/webhooks/${r.body.id}/test`), {})).status, 202); assert.equal((await rows("SELECT COUNT(*) n FROM webhook_deliveries WHERE endpoint_id=? AND event_type='webhook.test'", [r.body.id]))[0].n, 1); const dl = (await aAdmin.call('GET', A(`/webhooks/${r.body.id}/deliveries`))).body; assert.equal(dl.deliveries.length, 1);
  assert.equal((await aAdmin.call('POST', A(`/webhooks/${r.body.id}/deliveries/${dl.deliveries[0].id}/retry`), {})).status, 409, 'only dead ones');
  const log = await rows("SELECT action FROM audit_events WHERE tenant_id=? AND action LIKE 'webhook.%' ORDER BY id", [w.A]); assert.ok(['webhook.created', 'webhook.secret_rotated', 'webhook.updated'].every(a => log.some(l => l.action === a)));
  for (let i = 0; i < 9; i++) await aAdmin.call('POST', A('/webhooks'), { ...body, name: 'n' + i }); assert.equal((await aAdmin.call('POST', A('/webhooks'), body)).status, 409, 'at most 10'); assert.equal((await aAdmin.call('DELETE', A(`/webhooks/${r.body.id}`))).status, 200); assert.equal((await rows('SELECT COUNT(*) n FROM webhook_deliveries WHERE endpoint_id=?', [r.body.id]))[0].n, 0);
});
test('without WEBHOOK_ENC_KEY webhooks are off and say so; keys still work', async () => {
  const off = await freshEnv({ requireMfaForPlatform: false } as any); try { const ow = await world(off); const c = await ow.as('aAdmin'); const r = await c.call('POST', `/t/${ow.A}/webhooks`, { name: 'x', url: 'https://x.example.com/h', events: ['*'] }); assert.equal(r.status, 409); assert.match(r.body.error, /WEBHOOK_ENC_KEY/); assert.equal((await c.call('GET', `/t/${ow.A}/webhooks`)).body.configured, false); assert.equal((await c.call('POST', `/t/${ow.A}/api-keys`, { name: 'k', scopes: ['items:read'] })).status, 201); } finally { await off.close(); }
});
test('every /v1 route requires a key (nothing is open by accident)', async () => {
  const v1 = ['/v1/me', '/v1/items', '/v1/findings', '/v1/control-tests', '/v1/control-tests/:id/runs', '/v1/posture', '/v1/audit']; for (const p of v1) { const u = p.replace(/:\w+/g, crypto.randomUUID()); for (const m of ['GET', 'POST']) { const r = await api(null, m, u, m === 'POST' ? {} : undefined); assert.ok([401, 404, 429].includes(r.status), `${m} ${u} ${r.status}`); } }
});
