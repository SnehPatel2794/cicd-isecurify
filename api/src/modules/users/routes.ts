import { z } from 'zod'; import type { FastifyInstance } from 'fastify';
import { q, tx } from '../../db'; import type { Ctx } from '../../platform/context'; import { isAdminLevel } from '../../platform/context';
import { audit } from '../../platform/audit'; import { HttpError, bad, forbidden, notFound, conflict } from '../../platform/errors';
import { mayModifyUser, platformRolesGrantableBy, type PlatformRole } from '../tenancy/policy';
import { listUsersWithOrgCounts } from '../tenancy/data';
import { deletionSummary, buildManifestPdf, softDeleteUser, getUser } from './service';

export function registerUsers(app: FastifyInstance, ctx: Ctx, adminLevel: any, createInvite: any) {
  const { pool } = ctx; const me = (req: any) => ctx.U(req);
  app.get('/platform/users', { preHandler: adminLevel }, async (req: any) => {
    const f = ctx.parse(z.object({ q: z.string().max(100).optional(), status: z.enum(['active', 'disabled', 'deleted']).optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }), req.query);
    return listUsersWithOrgCounts(pool, f);
  });
  app.post('/platform/users', { preHandler: adminLevel }, async (req: any, reply) => {
    const b = ctx.parse(z.object({ email: z.string().email().max(190), platformRole: z.enum(['super_admin', 'admin', 'isecurify_team']) }), req.body);
    if (!platformRolesGrantableBy(me(req).platformRole as PlatformRole).includes(b.platformRole)) throw forbidden('You cannot create a user with this role');
    reply.code(201).send({ id: await createInvite({ tenantId: null, kind: 'platform', email: b.email, role: b.platformRole, invitedBy: me(req).id, ip: req.ip }) });
  });
  app.patch('/platform/users/:id', { preHandler: adminLevel }, async (req: any) => {
    const b = ctx.parse(z.object({ platformRole: z.enum(['super_admin', 'admin', 'isecurify_team']).optional(), status: z.enum(['active', 'disabled']).optional() }), req.body); const actor = me(req);
    await tx(pool, async (c) => {
      const u = (await q(c, 'SELECT * FROM users WHERE id=? FOR UPDATE', [req.params.id]))[0]; if (!u || u.status === 'deleted') throw notFound();
      if (u.id === actor.id) throw bad('You cannot change your own role or status');
      if (!mayModifyUser(actor.platformRole as PlatformRole, u.platform_role)) throw forbidden('Not allowed to modify this user');
      if (b.platformRole) {
        if (u.platform_role === 'none') throw bad('Customer users are not platform users; invite them as a platform user instead');
        if (!platformRolesGrantableBy(actor.platformRole as PlatformRole).includes(b.platformRole)) throw forbidden('You cannot grant this role');
      }
      const losesSuper = u.platform_role === 'super_admin' && ((b.platformRole && b.platformRole !== 'super_admin') || b.status === 'disabled');
      if (losesSuper && (await q(c, "SELECT COUNT(*) n FROM users WHERE platform_role='super_admin' AND status='active' AND id<>? FOR UPDATE", [u.id]))[0].n === 0) throw conflict('There must always be at least one active Super Admin');
      await c.query('UPDATE users SET platform_role=?, status=? WHERE id=?', [b.platformRole ?? u.platform_role, b.status ?? u.status, u.id]);
      if (b.status === 'disabled' || (b.platformRole && b.platformRole !== u.platform_role)) await c.query('DELETE FROM sessions WHERE user_id=?', [u.id]);   // takes effect immediately
      await audit(c, { actorId: actor.id, action: b.status && b.status !== u.status ? `user.${b.status === 'disabled' ? 'disabled' : 'enabled'}` : 'user.role_changed', entity: 'user', entityId: u.id, detail: { before: { role: u.platform_role, status: u.status }, after: b }, ip: req.ip });
    });
    return { ok: true };
  });
  app.get('/platform/users/:id/deletion-summary', { preHandler: adminLevel }, async (req: any) => deletionSummary(pool, req.params.id));
  app.get('/platform/users/:id/backup', { preHandler: adminLevel }, async (req: any, reply) => {
    const u = await getUser(pool, req.params.id); if (!u) throw notFound();
    if (!mayModifyUser(me(req).platformRole as PlatformRole, u.platform_role)) throw forbidden();
    const pdf = await buildManifestPdf(pool, u.id);
    await audit(pool, { actorId: me(req).id, action: 'user.backup_generated', entity: 'user', entityId: u.id, ip: req.ip });
    reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename="account-backup-${u.id.slice(0, 8)}.pdf"`).send(pdf);
  });
  app.post('/platform/users/:id/delete', { preHandler: adminLevel }, async (req: any) => {
    const b = ctx.parse(z.object({ reason: z.string().max(500).optional(), withoutBackup: z.boolean().optional(), confirmEmail: z.string().max(190).optional() }), req.body ?? {});
    return softDeleteUser(pool, { actor: { id: me(req).id, platformRole: me(req).platformRole as PlatformRole }, targetId: req.params.id, ...b, ip: req.ip });
  });
  app.get('/platform/deletion-log', { preHandler: adminLevel }, async () => q(pool, 'SELECT l.id,l.deleted_user_id,l.name_snapshot,l.email_snapshot,l.backup_taken,l.reason,l.created_at,u.name performed_by FROM user_deletion_log l JOIN users u ON u.id=l.performed_by ORDER BY l.id DESC LIMIT 200'));
}
