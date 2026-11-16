import { z } from 'zod'; import type { FastifyInstance } from 'fastify';
import { q, tx } from '../../db'; import type { Ctx } from '../../platform/context'; import { isAdminLevel } from '../../platform/context';
import { audit } from '../../platform/audit'; import { enqueue } from '../../platform/jobs';
import { uuid, sha256, newToken, hashPassword, passwordOk } from '../../platform/crypto';
import { HttpError, bad, forbidden, notFound, conflict } from '../../platform/errors';
import * as d from './data'; import { CLIENT_ROLES, type ClientRole } from './data';
import { rolesActorMayAssign, mayChangeRole, mayRemoveMember, type Actor } from './policy';
import { collectBlockers } from '../users/hooks';

const Role = z.enum(CLIENT_ROLES); const Email = z.string().email().max(190);
const INVITE_DAYS = 7;

export function registerTenancy(app: FastifyInstance, ctx: Ctx) {
  const { pool } = ctx;
  /** Every /t/:tenantId/* route runs this first. No access => 404 (never reveals that a tenant or record exists). */
  const tenantCtx = async (req: any) => {
    await ctx.withSession()(req);
    const access = await d.resolveAccess(pool, ctx.U(req).id, req.params.tenantId);
    if (!access) throw notFound();
    if (access.orgStatus !== 'active') throw new HttpError(403, 'This organization is not active', 'org_inactive');
    req.access = access; req.tenantId = req.params.tenantId;
  };
  const adminLevel = async (req: any) => { await ctx.withSession()(req); if (!isAdminLevel(ctx.U(req))) throw forbidden(); };
  const actorOf = (req: any): Actor => req.access.via === 'member' && req.access.role === 'client_admin' ? { kind: 'client_admin' } : req.access.via === 'staff' && req.access.manage ? { kind: 'staff_manager' } : { kind: 'none' };

  async function createInvite(o: { tenantId: string | null; kind: 'tenant' | 'platform'; email: string; role: string; invitedBy: string; ip?: string }) {
    const email = o.email.toLowerCase(); const token = newToken(); const id = uuid();
    const org = o.tenantId ? await d.getOrg(pool, o.tenantId) : null;
    await tx(pool, async (c) => {
      if (await d.hasPendingInvite(c, o.tenantId, email)) throw conflict('An invitation for this email is already pending');
      const ex = (await q(c, "SELECT id FROM users WHERE email=? AND status<>'deleted'", [email]))[0];
      if (o.kind === 'platform' && ex) throw conflict('An account with this email already exists');
      if (ex && o.tenantId && (await d.getMember(c, o.tenantId, ex.id))) throw conflict('Already a member of this organization');
      await d.createInvitation(c, { id, tenantId: o.tenantId, kind: o.kind, email, role: o.role, tokenHash: sha256(token), invitedBy: o.invitedBy, expiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000) });
      await enqueue(c, { type: 'email.invitation', payload: { to: email, token, role: o.role, orgName: org?.name ?? null, kind: o.kind, expiresInDays: INVITE_DAYS } });
      await audit(c, { tenantId: o.tenantId, actorId: o.invitedBy, action: 'invitation.created', entity: 'invitation', entityId: id, detail: { email, role: o.role, kind: o.kind }, ip: o.ip });
    });
    return id;
  }

  // ================= platform: organizations =================
  app.post('/platform/organizations', { preHandler: adminLevel }, async (req: any, reply) => {
    const b = ctx.parse(z.object({ name: z.string().min(1).max(190), domain: z.string().max(190).optional(), retentionMonths: z.number().int().min(1).max(600).optional(), isDemo: z.boolean().optional() }), req.body); const id = uuid();
    await tx(pool, async (c) => { await c.query('INSERT INTO organizations(id,name,domain,retention_months,created_by,is_demo) VALUES (?,?,?,?,?,?)', [id, b.name, b.domain ?? null, b.retentionMonths ?? 84, ctx.U(req).id, b.isDemo ? 1 : 0]);
      await audit(c, { tenantId: id, actorId: ctx.U(req).id, action: 'org.created', entity: 'organization', entityId: id, detail: { name: b.name, demo: !!b.isDemo }, ip: req.ip }); });
    reply.code(201).send({ id });
  });
  app.get('/platform/organizations', { preHandler: adminLevel }, async () => {
    const [orgs, counts] = await Promise.all([q(pool, 'SELECT id,name,domain,status,retention_months,created_at,is_demo isDemo FROM organizations ORDER BY name'), d.memberCountsByOrg(pool)]);
    const m = new Map(counts.map((r: any) => [r.tenant_id, r.n])); return orgs.map((o: any) => ({ ...o, isDemo: !!o.isDemo, memberCount: m.get(o.id) ?? 0 }));   // metadata only, never tenant data
  });
  app.patch('/platform/organizations/:id', { preHandler: adminLevel }, async (req: any) => {
    const b = ctx.parse(z.object({ name: z.string().min(1).max(190).optional(), domain: z.string().max(190).nullable().optional(), status: z.enum(['active', 'suspended', 'archived']).optional(), retentionMonths: z.number().int().min(1).max(600).optional() }), req.body);
    const actor = ctx.U(req);
    await tx(pool, async (c) => {
      const o = (await q(c, 'SELECT * FROM organizations WHERE id=? FOR UPDATE', [req.params.id]))[0]; if (!o) throw notFound();
      if (b.status && b.status !== o.status && (b.status === 'archived' || o.status === 'archived') && actor.platformRole !== 'super_admin') throw forbidden('Only a Super Admin can archive or restore an organization');
      await c.query('UPDATE organizations SET name=?, domain=?, status=?, retention_months=? WHERE id=?', [b.name ?? o.name, b.domain === undefined ? o.domain : b.domain, b.status ?? o.status, b.retentionMonths ?? o.retention_months, o.id]);
      await audit(c, { tenantId: o.id, actorId: actor.id, action: b.status && b.status !== o.status ? `org.${b.status}` : 'org.updated', entity: 'organization', entityId: o.id, detail: { before: { name: o.name, status: o.status }, after: b }, ip: req.ip });
    });
    return { ok: true };
  });
  app.post('/platform/organizations/:id/invitations', { preHandler: adminLevel }, async (req: any, reply) => {
    const b = ctx.parse(z.object({ email: Email, role: Role }), req.body); const org = await d.getOrg(pool, req.params.id); if (!org) throw notFound();
    if (org.status !== 'active') throw conflict('Organization is not active');
    reply.code(201).send({ id: await createInvite({ tenantId: org.id, kind: 'tenant', email: b.email, role: b.role, invitedBy: ctx.U(req).id, ip: req.ip }) });
  });

  // ================= platform: iSecurify staff assignments =================
  app.get('/platform/organizations/:id/staff', { preHandler: adminLevel }, async (req: any) => { if (!(await d.getOrg(pool, req.params.id))) throw notFound(); return d.listStaff(pool, req.params.id); });
  app.post('/platform/organizations/:id/staff', { preHandler: adminLevel }, async (req: any, reply) => {
    const b = ctx.parse(z.object({ userId: z.string().uuid(), canManage: z.boolean().default(true), canReadEvidence: z.boolean().default(false), expiresAt: z.coerce.date().nullable().optional() }), req.body);
    if (!(await d.getOrg(pool, req.params.id))) throw notFound(); if (b.expiresAt && b.expiresAt <= new Date()) throw bad('Expiry must be in the future');
    const u = (await q(pool, 'SELECT status,platform_role FROM users WHERE id=?', [b.userId]))[0]; if (!u || u.status !== 'active' || u.platform_role === 'none') throw bad('User must be an active iSecurify team member');
    await tx(pool, async (c) => { await d.upsertStaff(c, req.params.id, b.userId, { canManage: b.canManage, canReadEvidence: b.canReadEvidence, expiresAt: b.expiresAt ?? null, grantedBy: ctx.U(req).id });
      await audit(c, { tenantId: req.params.id, actorId: ctx.U(req).id, action: 'staff.assigned', entity: 'user', entityId: b.userId, detail: { canManage: b.canManage, canReadEvidence: b.canReadEvidence, expiresAt: b.expiresAt ?? null, self: b.userId === ctx.U(req).id }, ip: req.ip }); });
    reply.code(201).send({ ok: true });
  });
  app.delete('/platform/organizations/:id/staff/:userId', { preHandler: adminLevel }, async (req: any) => {
    await tx(pool, async (c) => { if (!(await d.removeStaff(c, req.params.id, req.params.userId))) throw notFound();
      await audit(c, { tenantId: req.params.id, actorId: ctx.U(req).id, action: 'staff.unassigned', entity: 'user', entityId: req.params.userId, ip: req.ip }); });
    return { ok: true };
  });

  // ================= tenant: members & invitations =================
  const canSeeMembers = (req: any) => req.access.manage || req.access.role === 'tp_auditor';
  app.get('/t/:tenantId/members', { preHandler: tenantCtx }, async (req: any) => { if (!canSeeMembers(req)) throw forbidden(); return d.listMembers(pool, req.tenantId); });
  app.get('/t/:tenantId/invitations', { preHandler: tenantCtx }, async (req: any) => { if (!req.access.manage) throw forbidden(); return d.listInvitations(pool, req.tenantId); });
  app.post('/t/:tenantId/invitations', { preHandler: tenantCtx }, async (req: any, reply) => {
    const b = ctx.parse(z.object({ email: Email, role: Role }), req.body);
    if (!rolesActorMayAssign(actorOf(req)).includes(b.role)) throw forbidden('You cannot invite this role');
    reply.code(201).send({ id: await createInvite({ tenantId: req.tenantId, kind: 'tenant', email: b.email, role: b.role, invitedBy: ctx.U(req).id, ip: req.ip }) });
  });
  app.delete('/t/:tenantId/invitations/:id', { preHandler: tenantCtx }, async (req: any) => {
    const inv = await d.getInvitationInTenant(pool, req.tenantId, req.params.id); if (!inv) throw notFound();
    if (!rolesActorMayAssign(actorOf(req)).includes(inv.role)) throw forbidden();
    await tx(pool, async (c) => { await d.revokeInvitation(c, req.tenantId, inv.id); await audit(c, { tenantId: req.tenantId, actorId: ctx.U(req).id, action: 'invitation.revoked', entity: 'invitation', entityId: inv.id, ip: req.ip }); });
    return { ok: true };
  });
  app.patch('/t/:tenantId/members/:userId', { preHandler: tenantCtx }, async (req: any) => {
    const b = ctx.parse(z.object({ role: Role }), req.body); const me = ctx.U(req);
    await tx(pool, async (c) => {
      const m = await d.getMember(c, req.tenantId, req.params.userId); if (!m) throw notFound();
      if (m.id === me.id) throw bad('You cannot change your own role'); if (m.role === b.role) return;
      if (!mayChangeRole(actorOf(req), m.role, b.role)) throw forbidden('You cannot make this role change');
      if (m.role === 'client_admin' && (await d.countMembers(c, req.tenantId, 'client_admin')) <= 1) throw conflict('An organization must keep at least one client admin');
      await d.setMemberRole(c, req.tenantId, m.id, b.role);
      await audit(c, { tenantId: req.tenantId, actorId: me.id, action: 'member.role_changed', entity: 'user', entityId: m.id, detail: { from: m.role, to: b.role }, ip: req.ip });
    });
    return { ok: true };
  });
  app.delete('/t/:tenantId/members/:userId', { preHandler: tenantCtx }, async (req: any) => {
    const me = ctx.U(req);
    await tx(pool, async (c) => {
      const m = await d.getMember(c, req.tenantId, req.params.userId); if (!m) throw notFound();
      if (m.id === me.id) throw bad('You cannot remove yourself');
      if (!mayRemoveMember(actorOf(req), m.role)) throw forbidden('You cannot remove this member');
      const blockers = await collectBlockers(c, m.id, req.tenantId);
      if (blockers.length) throw new HttpError(409, 'Reassign this person\'s open items first', 'has_open_items');
      if (m.role === 'client_admin' && (await d.countMembers(c, req.tenantId, 'client_admin')) <= 1) throw conflict('An organization must keep at least one client admin');
      await d.removeMember(c, req.tenantId, m.id);
      await audit(c, { tenantId: req.tenantId, actorId: me.id, action: 'member.removed', entity: 'user', entityId: m.id, detail: { role: m.role }, ip: req.ip });
    });
    return { ok: true };
  });

  // ================= invitation acceptance (public + optional session) =================
  const peek = async (token: string) => { const inv = await d.findInvitationByTokenHash(pool, sha256(token)); if (!inv || (inv.kind === 'tenant' && inv.org_status !== 'active')) throw notFound(); return inv; };
  app.get('/invitations/:token', async (req: any) => {
    if (!ctx.limiter.allow('inv:' + req.ip, 30, 60_000)) throw new HttpError(429, 'Too many requests');
    const inv = await peek(req.params.token); const exists = !!(await q(pool, "SELECT 1 x FROM users WHERE email=? AND status='active'", [inv.email]))[0];
    return { kind: inv.kind, email: inv.email, role: inv.role, organization: inv.org_name ?? null, accountExists: exists, expiresAt: inv.expires_at };
  });
  app.post('/invitations/:token/accept', async (req: any, reply) => {
    if (!ctx.limiter.allow('invA:' + req.ip, 10, 60_000)) throw new HttpError(429, 'Too many requests');
    const b = ctx.parse(z.object({ name: z.string().min(1).max(190).optional(), password: z.string().optional() }), req.body ?? {});
    const hash = sha256(req.params.token); let sessionUserId: string | null = null;
    if (req.cookies && Object.keys(req.cookies).length) { try { await ctx.withSession()(req); sessionUserId = ctx.U(req).id; } catch (e: any) { if (e.code === 'csrf') throw e; } }
    const pre = await peek(req.params.token);
    const existing = (await q(pool, "SELECT id,status FROM users WHERE email=? AND status<>'deleted'", [pre.email]))[0];
    let ph: string | null = null;
    if (!existing) { if (!b.name || !passwordOk(b.password)) throw bad('Name and a strong password (12+ characters with upper case, lower case and a digit) are required'); ph = await hashPassword(b.password!); }
    const userId = await tx(pool, async (c) => {
      const inv = await d.findInvitationByTokenHash(c, hash, true); if (!inv || (inv.kind === 'tenant' && inv.org_status !== 'active')) throw notFound();
      const u = (await q(c, "SELECT id,status FROM users WHERE email=? AND status<>'deleted' FOR UPDATE", [inv.email]))[0]; let id: string;
      if (u) {
        if (u.status !== 'active') throw conflict('This account is disabled');
        if (inv.kind === 'platform') throw conflict('An account with this email already exists; ask an administrator to change its role');
        if (sessionUserId !== u.id) throw new HttpError(409, 'An account with this email exists. Sign in with it first, then open this link again.', 'login_required');
        id = u.id;
      } else {
        id = uuid(); await c.query('INSERT INTO users(id,email,name,password_hash,platform_role,password_changed_at) VALUES (?,?,?,?,?,NOW(3))', [id, inv.email, b.name, ph, inv.kind === 'platform' ? inv.role : 'none']);
      }
      if (inv.kind === 'tenant') await d.addMember(c, inv.tenant_id, id, inv.role as ClientRole);
      await d.markInvitationAccepted(c, inv.id);
      await audit(c, { tenantId: inv.tenant_id, actorId: id, action: 'invitation.accepted', entity: 'invitation', entityId: inv.id, detail: { role: inv.role, newAccount: !u }, ip: req.ip });
      return id;
    });
    reply.send({ ok: true, userId });
  });

  return { tenantCtx, adminLevel, createInvite };
}
