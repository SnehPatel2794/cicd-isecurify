// Prepares the data the browser journey starts from, through the public API only: first administrator, one organization, a published framework, two customer users.
import path from 'node:path'; const mysql = require(path.join(__dirname, '../api/node_modules/mysql2/promise'));
import { PORT_API, ADMIN_URL, DB_NAME, PASSWORD, USERS } from './env';
const BASE = `http://127.0.0.1:${PORT_API}`;
class C { cookie = ''; csrf = ''; async call(method: string, url: string, body?: any, form?: FormData) {
  const h: any = { origin: `http://127.0.0.1:5100` }; if (body !== undefined) h['content-type'] = 'application/json'; if (this.cookie) h.cookie = this.cookie; if (this.csrf && method !== 'GET') h['x-csrf-token'] = this.csrf;
  const r = await fetch(BASE + url, { method, headers: h, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) }); const sc = (r.headers as any).getSetCookie?.() ?? []; if (sc.length) this.cookie = sc[0].split(';')[0];
  let j: any = null; try { j = await r.json(); } catch { /* none */ } if (j?.csrfToken) this.csrf = j.csrfToken; if (r.status >= 400) throw new Error(`${method} ${url} -> ${r.status} ${JSON.stringify(j)}`); return j; } }
export async function seed() {
  const root = new C(); await root.call('POST', '/setup', { email: USERS.owner, name: 'Olive Owner', password: PASSWORD }); const me = await root.call('POST', '/auth/login', { email: USERS.owner, password: PASSWORD });
  const org = await root.call('POST', '/platform/organizations', { name: 'Acme E2E Ltd' });
  const CSV = 'Ref #,Domain / Clause,Requirement,Owner (Department)\nE2E-1,Access,Quarterly access review is performed,IT\nE2E-2,Governance,Information security policy is approved yearly,CISO\nE2E-3,Operations,Backups are restored and tested,IT\n';
  const fw = await root.call('POST', '/frameworks', { name: 'E2E Framework (fictional)' }); const fd = new FormData(); fd.append('file', new Blob([CSV]), 'controls.csv');
  await root.call('POST', `/releases/${fw.draftReleaseId}/import?confirm=true`, undefined, fd); await root.call('POST', `/releases/${fw.draftReleaseId}/publish`);
  await root.call('POST', `/platform/organizations/${org.id}/staff`, { userId: me.user.id, canManage: true, canReadEvidence: true });   // the iSecurify reviewer for this organization
  await root.call('POST', `/platform/organizations/${org.id}/invitations`, { email: USERS.admin, role: 'client_admin' });
  const db = await mysql.createConnection(ADMIN_URL.replace(/\/?$/, '/') + DB_NAME);
  const token = async (email: string) => { const [r]: any = await db.query("SELECT payload FROM jobs WHERE type='email.invitation' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.to'))=? ORDER BY id DESC LIMIT 1", [email]); const p = r[0].payload; return (typeof p === 'string' ? JSON.parse(p) : p).token as string; };
  await new C().call('POST', `/invitations/${await token(USERS.admin)}/accept`, { name: 'Casey Admin', password: PASSWORD });
  const ca = new C(); await ca.call('POST', '/auth/login', { email: USERS.admin, password: PASSWORD }); await ca.call('POST', `/t/${org.id}/invitations`, { email: USERS.vendor, role: 'third_party_vendor' });
  await new C().call('POST', `/invitations/${await token(USERS.vendor)}/accept`, { name: 'Vera Vendor', password: PASSWORD }); await db.end();
  return { orgId: org.id as string };
}
