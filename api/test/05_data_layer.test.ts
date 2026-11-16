import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { freshEnv } from './helpers';
import { rolesActorMayAssign, mayChangeRole, mayRemoveMember, platformRolesGrantableBy, mayModifyUser, type Actor } from '../src/modules/tenancy/policy'; import { CLIENT_ROLES } from '../src/modules/tenancy/data';
let env: Awaited<ReturnType<typeof freshEnv>>; before(async () => { env = await freshEnv(); }); after(() => env.close());
const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.join(d, e.name)] : []);

test('LINT: only the data layer may run SQL against tenant-owned tables', async () => {
  const [rows]: any = await env.pool.query("SELECT DISTINCT table_name t FROM information_schema.columns WHERE table_schema=? AND column_name='tenant_id'", [env.name]);
  const tenantTables: string[] = rows.map((r: any) => r.t ?? r.T ?? r.TABLE_NAME); for (const t of ['memberships', 'staff_assignments', 'audit_events', 'engagements', 'checklist_items', 'checklist_item_controls', 'soa_entries', 'phase_logs', 'engagement_members', 'engagement_frameworks', 'engagement_milestones', 'discovery_responses', 'evidence_requests', 'evidence_versions', 'evidence_reviews', 'evidence_scans', 'evidence_usage', 'findings', 'finding_events', 'finding_evidence', 'finding_imports', 'risks', 'risk_links', 'risk_events', 'policies', 'policy_versions', 'policy_acks', 'policy_events', 'incidents', 'incident_events', 'incident_risks', 'saved_views']) assert.ok(tenantTables.includes(t), t);
  const allowed = new Set(['restorecheck.ts', 'platform/outbox.ts', 'modules/storage/data.ts', 'modules/summary/data.ts', 'modules/continuous/data.ts', 'modules/integrations/data.ts', 'modules/signoff/data.ts', 'modules/vapt/data.ts', 'modules/questionnaires/data.ts', 'modules/tasks/data.ts', 'modules/demo/data.ts', 'modules/spog/data.ts', 'modules/tenancy/data.ts', 'modules/audit/data.ts', 'modules/engagements/data.ts', 'modules/evidence/data.ts', 'modules/findings/data.ts', 'modules/notifications/data.ts', 'modules/reports/data.ts', 'modules/certificates/data.ts', 'modules/analytics/data.ts', 'modules/risks/data.ts', 'modules/vendors/data.ts', 'modules/policies/data.ts', 'modules/incidents/data.ts', 'modules/views/data.ts', 'platform/audit.ts']);
  const re = new RegExp(`\\b(FROM|JOIN|INTO|UPDATE)\\s+\`?(${tenantTables.join('|')})\\b`, 'i'); const bad: string[] = [];
  for (const f of [...walk(src), ...walk(path.resolve(src, '../../shared'))]) { const rel = path.relative(src, f).replace(/\\/g, '/'); if (allowed.has(rel) || rel === '../../shared/readiness.ts' || rel === '../../shared/posture.ts') continue; const m = re.exec(fs.readFileSync(f, 'utf8')); if (m) bad.push(`${rel}: ${m[0]}`); }
  assert.deepEqual(bad, [], 'Tenant tables must only be accessed through modules/tenancy/data.ts or modules/audit/data.ts');
});
test('composite (tenant_id, id) foreign keys make cross-tenant references impossible (pattern used from Phase 4 on)', async () => {
  const P = env.pool; await P.query('CREATE TABLE pat_parent (tenant_id CHAR(36) NOT NULL, id CHAR(36) NOT NULL, PRIMARY KEY (tenant_id,id)) ENGINE=InnoDB');
  await P.query('CREATE TABLE pat_child (tenant_id CHAR(36) NOT NULL, id CHAR(36) NOT NULL, parent_id CHAR(36) NOT NULL, PRIMARY KEY (tenant_id,id), CONSTRAINT fk_pc FOREIGN KEY (tenant_id,parent_id) REFERENCES pat_parent(tenant_id,id) ON DELETE RESTRICT) ENGINE=InnoDB');
  await P.query("INSERT INTO pat_parent VALUES ('tenantX','p1')"); await P.query("INSERT INTO pat_child VALUES ('tenantX','c1','p1')");
  await assert.rejects(P.query("INSERT INTO pat_child VALUES ('tenantY','c2','p1')"), /foreign key/i);
  await assert.rejects(P.query("DELETE FROM pat_parent WHERE id='p1'"), /foreign key/i);
});
test('policy: who may assign which client roles', () => {
  const mk = (kind: Actor['kind']) => ({ kind } as Actor);
  assert.deepEqual(rolesActorMayAssign(mk('client_admin')), ['client_staff', 'third_party_vendor']); assert.deepEqual(rolesActorMayAssign(mk('none')), []);
  for (const k of ['platform_admin', 'staff_manager'] as const) assert.deepEqual(rolesActorMayAssign(mk(k)), [...CLIENT_ROLES]);
});
test('policy: exhaustive role-change and removal matrix for client_admin', () => {
  const ca: Actor = { kind: 'client_admin' }; const basic = ['client_staff', 'third_party_vendor'];
  for (const from of CLIENT_ROLES) { for (const to of CLIENT_ROLES) assert.equal(mayChangeRole(ca, from, to), basic.includes(from) && basic.includes(to), `${from}->${to}`); assert.equal(mayRemoveMember(ca, from), basic.includes(from)); }
  for (const k of ['platform_admin', 'staff_manager'] as const) for (const from of CLIENT_ROLES) for (const to of CLIENT_ROLES) assert.equal(mayChangeRole({ kind: k } as Actor, from, to), true);
  assert.equal(mayChangeRole({ kind: 'none' }, 'client_staff', 'client_admin'), false);
});
test('policy: platform escalation guard', () => {
  assert.deepEqual(platformRolesGrantableBy('super_admin'), ['super_admin', 'admin', 'isecurify_team']); assert.deepEqual(platformRolesGrantableBy('admin'), ['isecurify_team']);
  assert.deepEqual(platformRolesGrantableBy('isecurify_team'), []); assert.deepEqual(platformRolesGrantableBy('none'), []);
  for (const t of ['super_admin', 'admin', 'isecurify_team', 'none'] as const) { assert.equal(mayModifyUser('super_admin', t), true); assert.equal(mayModifyUser('admin', t), t === 'none' || t === 'isecurify_team'); assert.equal(mayModifyUser('isecurify_team', t), false); }
});
