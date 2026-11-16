// Storage administration (Phase 10D): usage and quotas per organization, disk space, legal holds, archive state and the quarantine list.
// Platform administrators only. Nothing here deletes evidence.
import { z } from 'zod'; import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../../platform/context'; import { isAdminLevel } from '../../platform/context'; import { audit } from '../../platform/audit'; import { tx } from '../../db';
import { forbidden, notFound, bad } from '../../platform/errors'; import type { EvidenceConfig } from '../../config'; import type { LocalStorage } from '../../platform/storage'; import { getOrg } from '../tenancy/data';
import * as s from './data';
const Reason = z.string().trim().min(3).max(300).nullish();
export function registerStorage(app: FastifyInstance, ctx: Ctx, deps: { ev: EvidenceConfig; storage: Pick<LocalStorage, 'diskSpace'> }) {
  const { pool } = ctx; const me = (r: any) => ctx.U(r);
  const adminLevel = async (req: any) => { await ctx.withSession()(req); if (!isAdminLevel(me(req))) throw forbidden(); };
  app.get('/platform/storage', { preHandler: adminLevel }, async () => {
    const [orgs, disk, held, archived, quarantine] = await Promise.all([s.orgStorageRows(pool), deps.storage.diskSpace(), s.heldEngagements(pool), s.archivedList(pool), s.quarantine(pool, null)]);
    const rows = orgs.map((o: any) => { const eff = o.quotaBytes ?? deps.ev.defaultQuotaBytes; return { id: o.id, name: o.name, status: o.status, retentionMonths: o.retentionMonths, legalHold: !!o.legalHold, legalHoldReason: o.legalHoldReason, usedBytes: Number(o.usedBytes), versionCount: Number(o.versionCount),
      quotaBytes: eff, unlimited: eff == null, quotaIsDefault: o.quotaBytes == null, archivedEngagements: Number(o.archivedEngagements), infectedFiles: Number(o.infectedFiles), heldEngagements: Number(o.heldEngagements) }; });
    return { disk: disk ? { ...disk, minFreeBytes: deps.ev.minFreeBytes, low: deps.ev.minFreeBytes > 0 && disk.freeBytes < deps.ev.minFreeBytes + deps.ev.maxFileBytes } : null, defaults: { quotaBytes: deps.ev.defaultQuotaBytes, maxFileBytes: deps.ev.maxFileBytes, minFreeBytes: deps.ev.minFreeBytes },
      totals: { usedBytes: rows.reduce((a: number, r: any) => a + r.usedBytes, 0), versionCount: rows.reduce((a: number, r: any) => a + r.versionCount, 0), infectedFiles: rows.reduce((a: number, r: any) => a + r.infectedFiles, 0), archivedEngagements: rows.reduce((a: number, r: any) => a + r.archivedEngagements, 0) },
      orgs: rows, heldEngagements: held, archived, quarantine };
  });
  app.put('/platform/organizations/:orgId/legal-hold', { preHandler: adminLevel }, async (req: any) => {
    const b = ctx.parse(z.object({ hold: z.boolean(), reason: Reason }), req.body); if (b.hold && !b.reason) throw bad('Say why the hold is placed (3 to 300 characters)'); if (!(await getOrg(pool, req.params.orgId))) throw notFound();
    await tx(pool, async (c) => { await s.setOrgHold(c, req.params.orgId, b.hold, b.reason ?? null); await audit(c, { tenantId: req.params.orgId, actorId: me(req).id, action: b.hold ? 'legal_hold.placed' : 'legal_hold.released', entity: 'organization', entityId: req.params.orgId, detail: { reason: b.reason ?? null }, ip: req.ip }); });
    return { ok: true, legalHold: b.hold };
  });
  app.put('/platform/organizations/:orgId/engagements/:engagementId/legal-hold', { preHandler: adminLevel }, async (req: any) => {
    const b = ctx.parse(z.object({ hold: z.boolean(), reason: Reason }), req.body); if (b.hold && !b.reason) throw bad('Say why the hold is placed (3 to 300 characters)');
    const e = await s.getEngagementHold(pool, req.params.orgId, req.params.engagementId); if (!e) throw notFound();
    await tx(pool, async (c) => { await s.setEngagementHold(c, req.params.orgId, e.id, b.hold, b.reason ?? null); await audit(c, { tenantId: req.params.orgId, actorId: me(req).id, action: b.hold ? 'legal_hold.placed' : 'legal_hold.released', entity: 'engagement', entityId: e.id, detail: { engagementId: e.id, reason: b.reason ?? null }, ip: req.ip }); });
    return { ok: true, legalHold: b.hold };
  });
  app.post('/platform/organizations/:orgId/engagements/:engagementId/restore-archive', { preHandler: adminLevel }, async (req: any) => {
    const e = await s.getEngagementHold(pool, req.params.orgId, req.params.engagementId); if (!e) throw notFound();
    const ok = await tx(pool, async (c) => { const r = await s.restoreArchive(c, req.params.orgId, e.id, me(req).id); if (r) await audit(c, { tenantId: req.params.orgId, actorId: me(req).id, action: 'evidence.archive_restored', entity: 'engagement', entityId: e.id, detail: { engagementId: e.id }, ip: req.ip }); return r; });
    if (!ok) throw notFound(); return { ok: true };
  });
}
export const registerQuarantine = (app: FastifyInstance, ctx: Ctx, tenantCtx: any, canSee: (req: any) => boolean) => {
  app.get('/t/:tenantId/evidence/quarantine', { preHandler: tenantCtx }, async (req: any) => { if (!canSee(req)) throw forbidden(); return { files: await s.quarantine(ctx.pool, req.tenantId) }; });
};
