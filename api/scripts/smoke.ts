// End-to-end smoke test against a RUNNING stack on a FRESH database.  Usage: BASE=http://127.0.0.1:4000 npm run smoke
// Exercises: setup -> mandatory MFA -> org creation -> invitation -> accept -> tenant isolation -> audit. Exits non-zero on any failure.
import { hotp, b32decode } from '../src/platform/totp';
const BASE = process.env.BASE || 'http://127.0.0.1:4000'; const PW = 'Str0ngPassword!1';
class Client { cookie = ''; csrf = '';
  async call(method: string, url: string, body?: any) {
    const h: any = {}; if (body !== undefined) h['content-type'] = 'application/json'; if (this.cookie) h.cookie = this.cookie; if (this.csrf && method !== 'GET') h['x-csrf-token'] = this.csrf;
    const r = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.getSetCookie?.() ?? []; if (sc.length) this.cookie = sc[0].split(';')[0];
    let j: any = null; try { j = await r.json(); } catch { /* none */ } if (j?.csrfToken) this.csrf = j.csrfToken; return { status: r.status, body: j };
  } }
class Uploader extends Client { async upload(url: string, name: string, data: string | Uint8Array) {
  const fd = new FormData(); fd.append('file', new Blob([data as any]), name); const h: any = { cookie: this.cookie, 'x-csrf-token': this.csrf };
  const r = await fetch(BASE + url, { method: 'POST', headers: h, body: fd }); let j: any = null; try { j = await r.json(); } catch { /* none */ } return { status: r.status, body: j }; } }
let failed = 0; const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : extra}`); if (!ok) failed++; };
const totp = (secret: string, off = 0) => hotp(b32decode(secret), Math.floor(Date.now() / 30000) + off);
const root = new Client();
check('setup creates super admin', (await root.call('POST', '/setup', { email: 'owner@smoke.test', name: 'Owner', password: PW })).status === 201);
check('login ok', (await root.call('POST', '/auth/login', { email: 'owner@smoke.test', password: PW })).status === 200);
check('platform user blocked until MFA is enrolled', (await root.call('POST', '/platform/organizations', { name: 'X' })).body?.code === 'mfa_enrollment_required');
const enr = await root.call('POST', '/auth/mfa/enroll', {}); const secret = enr.body.secret;
check('MFA confirm', (await root.call('POST', '/auth/mfa/confirm', { code: totp(secret) })).status === 200);
// MFA confirm revokes other sessions but keeps this one; log in again fully to prove the MFA login path
const root2 = new Client(); const l = await root2.call('POST', '/auth/login', { email: 'owner@smoke.test', password: PW }); check('login now requires MFA', l.body.mfaRequired === true);
check('MFA verify', (await root2.call('POST', '/auth/mfa/verify', { code: totp(secret, 1) })).status === 200);
const org = await root2.call('POST', '/platform/organizations', { name: 'Acme Fintech' }); check('create organization', org.status === 201);
const org2 = await root2.call('POST', '/platform/organizations', { name: 'Northbridge Health' }); check('create second organization', org2.status === 201);
check('invite client admin', (await root2.call('POST', `/platform/organizations/${org.body.id}/invitations`, { email: 'ca@acme.test', role: 'client_admin' })).status === 201);
check('platform admin has NO tenant data access without assignment', (await root2.call('GET', `/t/${org.body.id}/members`)).status === 404);
// The invitation token only exists in the email job payload (erased by the worker after delivery). Read it from the DB: run this script while the worker is stopped.
import mysql from 'mysql2/promise';
const db = await mysql.createConnection(process.env.SMOKE_DB_URL!);
const tokenFor = async (email: string) => { const [r]: any = await db.query("SELECT payload FROM jobs WHERE type='email.invitation' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.to'))=? ORDER BY id DESC LIMIT 1", [email]); const p = r[0].payload; return (typeof p === 'string' ? JSON.parse(p) : p).token as string; };
const accept = async (email: string, name: string) => new Client().call('POST', `/invitations/${await tokenFor(email)}/accept`, { name, password: PW });
check('client admin accepts invitation', (await accept('ca@acme.test', 'Casey Admin')).status === 200);
const ca = new Client(); check('client admin logs in (no MFA required for customer roles)', (await ca.call('POST', '/auth/login', { email: 'ca@acme.test', password: PW })).status === 200);
check('client admin sees only their organization', (await ca.call('GET', '/auth/me')).body.organizations.length === 1);
check('client admin invites a vendor', (await ca.call('POST', `/t/${org.body.id}/invitations`, { email: 'vendor@acme.test', role: 'third_party_vendor' })).status === 201);
check('client admin cannot appoint an auditor', (await ca.call('POST', `/t/${org.body.id}/invitations`, { email: 'aud@acme.test', role: 'tp_auditor' })).status === 403);
check('client admin cannot see another tenant (404)', (await ca.call('GET', `/t/${org2.body.id}/members`)).status === 404);
check('client admin cannot reach platform endpoints', (await ca.call('GET', '/platform/organizations')).status === 403);
check('vendor accepts and cannot list members', (await accept('vendor@acme.test', 'Vera Vendor')).status === 200);
const v = new Client(); await v.call('POST', '/auth/login', { email: 'vendor@acme.test', password: PW }); check('vendor gets 403 on member list', (await v.call('GET', `/t/${org.body.id}/members`)).status === 403);
const audit = await ca.call('GET', `/t/${org.body.id}/audit?limit=100`); check('tenant audit log has invitation + acceptance entries and only this tenant', audit.body.items.some((e: any) => e.action === 'invitation.accepted') && audit.body.items.every((e: any) => e.tenant_id === org.body.id));
check('platform audit is admin-level only', (await root2.call('GET', '/platform/audit')).status === 200 && (await ca.call('GET', '/platform/audit')).status === 403);
// ---------- Phase 3: framework library ----------
const adm = new Uploader(); adm.cookie = root2.cookie; adm.csrf = root2.csrf;
const fw = await adm.call('POST', '/frameworks', { name: 'Smoke Framework (fictional)' }); check('create framework (draft v1)', fw.status === 201);
const rid = fw.body.draftReleaseId; const CSV = 'Ref #,Domain / Clause,Requirement,Owner (Department)\nS-1,Governance,Policy approved yearly,CISO\nS-2,Access,Quarterly access review,IT\nS-3,Access,=HYPERLINK("http://evil.example"),IT\n';
const prev = await adm.upload(`/releases/${rid}/import`, 'c.csv', CSV); check('import preview: 2 valid, 1 formula row refused, nothing saved', prev.status === 200 && prev.body.counts.valid === 2 && prev.body.counts.invalid === 1 && (await adm.call('GET', `/releases/${rid}/controls`)).body.length === 0);
check('import confirm saves the valid rows', (await adm.upload(`/releases/${rid}/import?confirm=true`, 'c.csv', CSV)).body.imported === 2);
check('disguised executable is refused', (await adm.upload(`/releases/${rid}/import`, 'run.exe', CSV)).status === 400);
check('publish release', (await adm.call('POST', `/releases/${rid}/publish`)).status === 200);
check('published release is immutable via API (409)', (await adm.call('POST', `/releases/${rid}/controls`, { ref: 'S-9', domain: 'd', title: 't' })).status === 409);
const nd = await adm.call('POST', `/releases/${rid}/new-draft`); check('new draft v2 copies 2 controls', nd.status === 201 && nd.body.version === 2 && nd.body.controls === 2);
await adm.call('POST', `/releases/${nd.body.id}/controls`, { ref: 'S-4', domain: 'Ops', title: 'Backups tested' });
const cmpR = await adm.call('GET', `/releases/${rid}/compare/${nd.body.id}`); check('compare v1 to v2: 1 added', cmpR.body.summary.added === 1 && cmpR.body.summary.unchanged === 2);
const cc = await adm.call('POST', '/common-controls', { title: 'Smoke common control' }); const ctls = (await adm.call('GET', `/releases/${rid}/controls`)).body;
check('map a PUBLISHED control to a common control', (await adm.call('PUT', `/controls/${ctls[0].id}/mapping`, { commonControlId: cc.body.id })).status === 200);
check('customer users cannot read the library', (await ca.call('GET', '/frameworks')).status === 403);
// ---------- Phase 4: engagements ----------
const [[vrow]]: any = await db.query("SELECT id FROM users WHERE email='vendor@acme.test'"); const [[orow]]: any = await db.query("SELECT id FROM users WHERE email='owner@smoke.test'"); const orgId = org.body.id;
const fwB = await adm.call('POST', '/frameworks', { name: 'Smoke Framework B (fictional)' }); await adm.call('POST', `/releases/${fwB.body.draftReleaseId}/controls`, { ref: 'B-1', domain: 'Auth', title: 'Strong authentication' });
const bCtl = (await adm.call('GET', `/releases/${fwB.body.draftReleaseId}/controls`)).body[0]; await adm.call('PUT', `/controls/${bCtl.id}/mapping`, { commonControlId: cc.body.id }); await adm.call('POST', `/releases/${fwB.body.draftReleaseId}/publish`);
const av = await ca.call('GET', `/t/${orgId}/available-frameworks`); check('client admin can list published frameworks to choose from', av.status === 200 && av.body.some((f: any) => f.name.startsWith('Smoke Framework B')));
const prevE = await ca.call('GET', `/t/${orgId}/engagements/overlap-preview?releaseIds=${rid},${fwB.body.draftReleaseId}`); check('overlap preview: 1 duplicate avoided across 2 frameworks', prevE.status === 200 && prevE.body.duplicatesAvoided === 1 && prevE.body.shared.length === 1);
const eng = await ca.call('POST', `/t/${orgId}/engagements`, { name: 'Smoke Engagement', primaryReleaseId: rid, additionalReleaseIds: [fwB.body.draftReleaseId] }); check('create 2-framework engagement; shared item merged, not duplicated', eng.status === 201 && eng.body.summary.totalMerged === 1 && eng.body.summary.sharedEvidenceItems === 1);
const E = eng.body.id; const cl = await ca.call('GET', `/t/${orgId}/engagements/${E}/checklist`); check('checklist has 2 items (3 controls - 1 merged) with a 2-framework "satisfies" list', cl.body.items.length === 2 && cl.body.items.some((i: any) => i.satisfies.length === 2));
check('SOA lists all 3 controls', (await ca.call('GET', `/t/${orgId}/engagements/${E}/soa`)).body.summary.total === 3);
check('client admin assigns an item to the vendor', (await ca.call('PATCH', `/t/${orgId}/checklist/${cl.body.items[0].id}`, { accountableUserId: vrow.id })).status === 200);
const ve = await v.call('GET', `/t/${orgId}/engagements`); check('vendor sees the engagement but only 1 assigned item', ve.body.length === 1 && ve.body[0].summary.total === 1 && (await v.call('GET', `/t/${orgId}/engagements/${E}/checklist`)).body.items.length === 1);
check('vendor cannot read the SOA or the whole team', (await v.call('GET', `/t/${orgId}/engagements/${E}/soa`)).status === 403 && (await v.call('GET', `/t/${orgId}/engagements/${E}/members`)).status === 403);
check('vendor can set readiness of their own item, nothing else', (await v.call('PATCH', `/t/${orgId}/checklist/${cl.body.items[0].id}`, { readiness: 'implemented' })).status === 200 && (await v.call('PATCH', `/t/${orgId}/checklist/${cl.body.items[0].id}`, { dueDate: '2030-01-01' })).status === 403);
const st = (await ca.call('GET', `/t/${orgId}/engagements/${E}/checklist`)).body.items.find((i: any) => i.id === cl.body.items[0].id).state; check('implemented without auditor-accepted evidence is "blocked", never "effective"', st === 'blocked_missing_evidence');
check('client admin cannot advance the phase', (await ca.call('POST', `/t/${orgId}/engagements/${E}/advance-phase`)).status === 403);
check('admin assigns themselves (audited) and advances the phase', (await adm.call('POST', `/platform/organizations/${orgId}/staff`, { userId: orow.id, canManage: true })).status === 201 && (await adm.call('POST', `/t/${orgId}/engagements/${E}/advance-phase`)).body.currentPhase === 2);
check('N/A without justification is refused', (await adm.call('PATCH', `/t/${orgId}/checklist/${cl.body.items[1].id}`, { readiness: 'not_applicable' })).status === 400);
const dsh = await ca.call('GET', `/t/${orgId}/dashboard`); check('dashboard numbers come from the evaluation service', dsh.body.summary.total === 2 && dsh.body.summary.byState.blocked_missing_evidence === 1 && dsh.body.summary.effective === 0);
check('anonymous callers cannot see the engagement (401)', (await new Client().call('GET', `/t/${orgId}/engagements/${E}`)).status === 401);
const [[leak]]: any = await db.query("SELECT COUNT(*) n FROM engagements WHERE tenant_id=?", [org2.body.id]); check('nothing leaked into the other organization', leak.n === 0);
await db.end(); console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL SMOKE CHECKS PASSED'); process.exit(failed ? 1 : 0);
