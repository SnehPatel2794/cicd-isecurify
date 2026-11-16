// Notification routes. These belong to the signed-in person, not to one organization, so they live under /me. What a person sees is limited to
// the organizations they can enter right now; unreadable or foreign ids are simply ignored (never an error that confirms they exist).
import { emailDefault } from './kinds'; import { z } from 'zod'; import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../../platform/context'; import { listAccessibleOrgs } from '../tenancy/data'; import * as n from './data'; import { KINDS, KIND_LIST, isKind } from './kinds';

export function registerNotifications(app: FastifyInstance, ctx: Ctx) {
  const { pool } = ctx; const me = (r: any) => ctx.U(r); const session = { preHandler: ctx.withSession() };
  const tenants = async (userId: string) => (await listAccessibleOrgs(pool, userId)).filter((o: any) => o.status !== 'archived').map((o: any) => o.id as string).filter((v, i, a) => a.indexOf(v) === i);
  /** Cheap enough to poll every minute: one indexed count. */
  app.get('/me/notifications/count', session, async (req: any) => { const t = await tenants(me(req).id); return { unread: await n.unreadCount(pool, me(req).id, t) }; });
  app.get('/me/notifications', session, async (req: any) => {
    const f = ctx.parse(z.object({ unread: z.enum(['true', 'false']).optional(), tenantId: z.string().uuid().optional(), before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }), req.query);
    const t = await tenants(me(req).id); const rows = await n.listFor(pool, me(req).id, t, { unread: f.unread === 'true', tenantId: f.tenantId, beforeId: f.before, limit: f.limit + 1 });
    const page = rows.slice(0, f.limit); const [unread, by] = await Promise.all([n.unreadCount(pool, me(req).id, t), n.unreadByTenant(pool, me(req).id, t)]);
    return { unread, unreadByTenant: Object.fromEntries(by.map((r: any) => [r.tenantId, Number(r.n)])), nextBefore: rows.length > f.limit ? page[page.length - 1].id : null,
      notifications: page.map((r: any) => ({ ...r, id: Number(r.id), read: !!r.readAt, kindLabel: isKind(r.kind) ? KINDS[r.kind].label : r.kind })) };
  });
  app.post('/me/notifications/read', session, async (req: any) => {
    const b = ctx.parse(z.object({ ids: z.array(z.number().int().positive()).max(200).optional(), all: z.literal(true).optional() }).refine(x => !!x.ids !== !!x.all, 'Give either ids or all'), req.body);
    const t = await tenants(me(req).id); return { marked: await n.markRead(pool, me(req).id, t, b.all ? 'all' : b.ids!) };
  });
  app.get('/me/notification-prefs', session, async (req: any) => {
    const rows = await n.getPrefs(pool, me(req).id); const off = new Map(rows.map((r: any) => [r.kind as string, !!r.inApp])); const em = new Map(rows.filter((r: any) => r.emailOn !== null).map((r: any) => [r.kind as string, !!r.emailOn]));
    return { kinds: KIND_LIST.map(k => ({ kind: k, group: KINDS[k].group, label: KINDS[k].label, inApp: off.has(k) ? off.get(k)! : true, email: em.has(k) ? em.get(k)! : emailDefault(k) })) };
  });
  app.get('/me/email-digest', session, async (req: any) => n.getDigest(pool, me(req).id));
  app.put('/me/email-digest', session, async (req: any) => { const b = ctx.parse(z.object({ frequency: z.enum(['off', 'daily', 'weekly']) }), req.body); await n.setDigest(pool, me(req).id, b.frequency); return { ok: true }; });
  app.put('/me/notification-prefs', session, async (req: any) => {
    const b = ctx.parse(z.object({ kind: z.string().refine(isKind, 'Unknown notification kind'), inApp: z.boolean().optional(), email: z.boolean().optional() }).refine(v => v.inApp !== undefined || v.email !== undefined, 'Nothing to change'), req.body); await n.setPref(pool, me(req).id, b.kind, { inApp: b.inApp, email: b.email }); return { ok: true };
  });
}
