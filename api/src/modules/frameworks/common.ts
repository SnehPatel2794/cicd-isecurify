import { z } from 'zod'; import type { FastifyInstance } from 'fastify';
import { q, tx } from '../../db'; import type { Ctx } from '../../platform/context'; import { isAdminLevel } from '../../platform/context';
import { audit } from '../../platform/audit'; import { uuid } from '../../platform/crypto'; import { HttpError, forbidden, notFound } from '../../platform/errors';

/** Common controls: one authoritative control that several frameworks' controls point at. Mapping is metadata, so it stays editable after a release is
 *  published, but every change is recorded in the append-only control_mapping_history. Engagements (Phase 4) copy the links they used when created. */
export function registerCommonControls(app: FastifyInstance, ctx: Ctx) {
  const { pool } = ctx; const me = (r: any) => ctx.U(r);
  const platformUser = async (req: any) => { await ctx.withSession()(req); if (me(req).platformRole === 'none') throw forbidden(); };
  const adminLevel = async (req: any) => { await ctx.withSession()(req); if (!isAdminLevel(me(req))) throw forbidden(); };
  const Body = z.object({ title: z.string().trim().min(1).max(190), description: z.string().max(5000).nullish() });

  app.get('/common-controls', { preHandler: platformUser }, async () => q(pool, `SELECT cc.id,cc.title,cc.description,(SELECT COUNT(*) FROM control_mappings m WHERE m.common_control_id=cc.id) mappedCount,
    (SELECT COUNT(DISTINCT r.framework_id) FROM control_mappings m JOIN framework_controls c ON c.id=m.control_id JOIN framework_releases r ON r.id=c.release_id WHERE m.common_control_id=cc.id) frameworkCount FROM common_controls cc ORDER BY cc.title`));
  app.get('/common-controls/:id', { preHandler: platformUser }, async (req: any) => {
    const cc = (await q(pool, 'SELECT id,title,description FROM common_controls WHERE id=?', [req.params.id]))[0]; if (!cc) throw notFound(); const admin = isAdminLevel(me(req));
    const controls = await q(pool, `SELECT c.id controlId,c.ref,c.title,f.id frameworkId,f.name frameworkName,f.color,r.id releaseId,r.version,r.status releaseStatus,m.rationale FROM control_mappings m JOIN framework_controls c ON c.id=m.control_id
      JOIN framework_releases r ON r.id=c.release_id JOIN frameworks f ON f.id=r.framework_id WHERE m.common_control_id=? ${admin ? '' : "AND r.status='published'"} ORDER BY f.name,r.version,c.ref`, [cc.id]);
    return { ...cc, controls };
  });
  app.post('/common-controls', { preHandler: adminLevel }, async (req: any, reply) => {
    const b = ctx.parse(Body, req.body); const id = uuid();
    await tx(pool, async (c) => { await c.query('INSERT INTO common_controls(id,title,description,created_by) VALUES (?,?,?,?)', [id, b.title, b.description ?? null, me(req).id]); await audit(c, { actorId: me(req).id, action: 'common_control.created', entity: 'common_control', entityId: id, detail: { title: b.title }, ip: req.ip }); });
    reply.code(201).send({ id });
  });
  app.patch('/common-controls/:id', { preHandler: adminLevel }, async (req: any) => {
    const b = ctx.parse(Body.partial(), req.body);
    await tx(pool, async (c) => { const cur = (await q(c, 'SELECT * FROM common_controls WHERE id=? FOR UPDATE', [req.params.id]))[0]; if (!cur) throw notFound();
      await c.query('UPDATE common_controls SET title=?,description=? WHERE id=?', [b.title ?? cur.title, b.description === undefined ? cur.description : b.description, cur.id]); await audit(c, { actorId: me(req).id, action: 'common_control.updated', entity: 'common_control', entityId: cur.id, detail: b, ip: req.ip }); });
    return { ok: true };
  });
  app.delete('/common-controls/:id', { preHandler: adminLevel }, async (req: any) => {
    await tx(pool, async (c) => { const cur = (await q(c, 'SELECT id,title FROM common_controls WHERE id=? FOR UPDATE', [req.params.id]))[0]; if (!cur) throw notFound();
      if ((await q(c, 'SELECT COUNT(*) n FROM control_mappings WHERE common_control_id=?', [cur.id]))[0].n) throw new HttpError(409, 'Unmap its controls before deleting this common control', 'has_mappings');
      await c.query('DELETE FROM common_controls WHERE id=?', [cur.id]); await audit(c, { actorId: me(req).id, action: 'common_control.deleted', entity: 'common_control', entityId: cur.id, detail: { title: cur.title }, ip: req.ip }); });
    return { ok: true };
  });
  const loadControl = async (c: any, id: string) => { const x = (await q(c, 'SELECT c.id,c.ref,f.archived,r.status releaseStatus FROM framework_controls c JOIN framework_releases r ON r.id=c.release_id JOIN frameworks f ON f.id=r.framework_id WHERE c.id=? FOR UPDATE', [id]))[0]; if (!x) throw notFound(); if (x.archived) throw new HttpError(409, 'This framework is archived', 'framework_archived'); return x; };
  const superAdmin = async (req: any) => { await ctx.withSession()(req); if (me(req).platformRole !== 'super_admin') throw forbidden('Only a Super Admin can change this policy'); };
  const approvalOn = async (c: any) => (await q(c, "SELECT setting_value v FROM platform_settings WHERE setting_key='mapping_approval'"))[0]?.v === 'on';
  /** When the policy is on, a published release's mapping can only change through an approved request (a second administrator decides). Drafts stay direct. */
  const needsApproval = async (c: any, ctl: any) => ctl.releaseStatus === 'published' && await approvalOn(c);
  const refuse = () => new HttpError(409, 'Mapping changes on a published framework need a second administrator to approve them. Submit a change request instead.', 'approval_required');
  /** The one place a mapping is written: used by direct edits and by approved requests. `via` records who asked when an approver applies it. */
  async function applyMap(c: any, ctl: any, commonControlId: string, rationale: string | null, actorId: string, ip: string | undefined, via?: string) {
    const prev = (await q(c, 'SELECT common_control_id FROM control_mappings WHERE control_id=? FOR UPDATE', [ctl.id]))[0];
    if (prev && prev.common_control_id === commonControlId) { await c.query('UPDATE control_mappings SET rationale=? WHERE control_id=?', [rationale, ctl.id]); return; }
    await c.query('INSERT INTO control_mappings(control_id,common_control_id,rationale,mapped_by) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE common_control_id=VALUES(common_control_id), rationale=VALUES(rationale), mapped_by=VALUES(mapped_by), mapped_at=NOW(3)', [ctl.id, commonControlId, rationale, actorId]);
    await c.query('INSERT INTO control_mapping_history(control_id,common_control_id,previous_common_control_id,action,rationale,actor_id) VALUES (?,?,?,?,?,?)', [ctl.id, commonControlId, prev?.common_control_id ?? null, prev ? 'change' : 'map', rationale, actorId]);
    await audit(c, { actorId, action: 'mapping.set', entity: 'control', entityId: ctl.id, detail: { ref: ctl.ref, commonControlId, previous: prev?.common_control_id ?? null, ...(via ? { requestedBy: via } : {}) }, ip });
  }
  async function applyUnmap(c: any, ctl: any, actorId: string, ip: string | undefined, via?: string) {
    const prev = (await q(c, 'SELECT common_control_id FROM control_mappings WHERE control_id=? FOR UPDATE', [ctl.id]))[0]; if (!prev) return false;
    await c.query('DELETE FROM control_mappings WHERE control_id=?', [ctl.id]);
    await c.query("INSERT INTO control_mapping_history(control_id,common_control_id,previous_common_control_id,action,actor_id) VALUES (?,NULL,?, 'unmap', ?)", [ctl.id, prev.common_control_id, actorId]);
    await audit(c, { actorId, action: 'mapping.removed', entity: 'control', entityId: ctl.id, detail: { ref: ctl.ref, previous: prev.common_control_id, ...(via ? { requestedBy: via } : {}) }, ip }); return true;
  }
  app.put('/controls/:controlId/mapping', { preHandler: adminLevel }, async (req: any) => {
    const b = ctx.parse(z.object({ commonControlId: z.string().uuid(), rationale: z.string().max(1000).nullish() }), req.body);
    await tx(pool, async (c) => {
      const ctl = await loadControl(c, req.params.controlId); if (!(await q(c, 'SELECT 1 x FROM common_controls WHERE id=?', [b.commonControlId]))[0]) throw notFound(); if (await needsApproval(c, ctl)) throw refuse();
      await applyMap(c, ctl, b.commonControlId, b.rationale ?? null, me(req).id, req.ip);
    });
    return { ok: true };
  });
  app.delete('/controls/:controlId/mapping', { preHandler: adminLevel }, async (req: any) => {
    await tx(pool, async (c) => { const ctl = await loadControl(c, req.params.controlId); if (await needsApproval(c, ctl)) throw refuse(); if (!(await applyUnmap(c, ctl, me(req).id, req.ip))) throw notFound(); });
    return { ok: true };
  });
  // ---------- two-person approval (Phase 9A) ----------
  app.get('/platform/settings/mapping-approval', { preHandler: adminLevel }, async () => ({ enabled: await approvalOn(pool) }));
  app.put('/platform/settings/mapping-approval', { preHandler: superAdmin }, async (req: any) => {
    const b = ctx.parse(z.object({ enabled: z.boolean() }), req.body);
    await tx(pool, async (c) => { await c.query("UPDATE platform_settings SET setting_value=?, updated_by=? WHERE setting_key='mapping_approval'", [b.enabled ? 'on' : 'off', me(req).id]); await audit(c, { actorId: me(req).id, action: 'settings.mapping_approval', entity: 'settings', entityId: 'mapping_approval', detail: { enabled: b.enabled }, ip: req.ip }); });
    return { enabled: b.enabled };
  });
  const REQ_COLS = `r.id, r.control_id controlId, c.ref controlRef, c.title controlTitle, f.name frameworkName, rel.version frameworkVersion, r.kind, r.common_control_id commonControlId, cc.title commonControlTitle, r.rationale, r.status, r.requested_by requestedById, ru.name requestedBy, r.requested_at requestedAt, du.name decidedBy, r.decided_at decidedAt, r.decision_note decisionNote`;
  const REQ_FROM = `FROM mapping_change_requests r JOIN framework_controls c ON c.id=r.control_id JOIN framework_releases rel ON rel.id=c.release_id JOIN frameworks f ON f.id=rel.framework_id JOIN users ru ON ru.id=r.requested_by LEFT JOIN users du ON du.id=r.decided_by LEFT JOIN common_controls cc ON cc.id=r.common_control_id`;
  app.get('/mapping-requests', { preHandler: adminLevel }, async (req: any) => { const st = ctx.parse(z.enum(['pending', 'approved', 'rejected', 'withdrawn', 'all']).default('pending'), req.query?.status);
    return { enabled: await approvalOn(pool), requests: await q(pool, `SELECT ${REQ_COLS} ${REQ_FROM} ${st === 'all' ? '' : 'WHERE r.status=?'} ORDER BY r.requested_at DESC, r.id LIMIT 200`, st === 'all' ? [] : [st]) }; });
  app.post('/controls/:controlId/mapping-requests', { preHandler: adminLevel }, async (req: any, reply) => {
    const b = ctx.parse(z.object({ commonControlId: z.string().uuid().nullable(), rationale: z.string().trim().min(3).max(1000) }), req.body); const id = uuid();
    await tx(pool, async (c) => {
      const ctl = await loadControl(c, req.params.controlId); if (!(await needsApproval(c, ctl))) throw new HttpError(409, 'This mapping can be changed directly: approval is not required here', 'approval_not_required');
      if (b.commonControlId && !(await q(c, 'SELECT 1 x FROM common_controls WHERE id=?', [b.commonControlId]))[0]) throw notFound();
      const cur = (await q(c, 'SELECT common_control_id v FROM control_mappings WHERE control_id=?', [ctl.id]))[0]?.v ?? null; if ((b.commonControlId ?? null) === cur) throw new HttpError(409, 'That is already the current mapping', 'no_change');
      if ((await q(c, "SELECT 1 x FROM mapping_change_requests WHERE control_id=? AND status='pending'", [ctl.id]))[0]) throw new HttpError(409, 'There is already a pending request for this control', 'request_pending');
      await c.query('INSERT INTO mapping_change_requests(id,control_id,kind,common_control_id,rationale,requested_by) VALUES (?,?,?,?,?,?)', [id, ctl.id, b.commonControlId ? 'set' : 'unset', b.commonControlId, b.rationale, me(req).id]);
      await audit(c, { actorId: me(req).id, action: 'mapping.requested', entity: 'control', entityId: ctl.id, detail: { ref: ctl.ref, requestId: id, kind: b.commonControlId ? 'set' : 'unset' }, ip: req.ip });
    });
    reply.code(201).send({ id });
  });
  const decide = (decision: 'approved' | 'rejected' | 'withdrawn') => async (req: any) => {
    const b = ctx.parse(z.object({ note: z.string().trim().max(1000).nullish() }), req.body ?? {}); if (decision === 'rejected' && !(b.note ?? '').length) throw new HttpError(400, 'Say why the request is rejected', 'note_required');
    await tx(pool, async (c) => {
      const r = (await q(c, 'SELECT * FROM mapping_change_requests WHERE id=? FOR UPDATE', [req.params.id]))[0]; if (!r) throw notFound(); if (r.status !== 'pending') throw new HttpError(409, 'This request has already been decided', 'already_decided');
      const mine = r.requested_by === me(req).id; if (decision === 'withdrawn' ? !mine : mine) throw new HttpError(403, decision === 'withdrawn' ? 'Only the person who made the request can withdraw it' : 'You cannot decide your own request: a second administrator must', decision === 'withdrawn' ? 'not_requester' : 'self_approval');
      if (decision === 'approved') { const ctl = await loadControl(c, r.control_id); const who = (await q(c, 'SELECT name FROM users WHERE id=?', [r.requested_by]))[0]?.name;
        if (r.kind === 'set') { if (!(await q(c, 'SELECT 1 x FROM common_controls WHERE id=?', [r.common_control_id]))[0]) throw notFound(); await applyMap(c, ctl, r.common_control_id, r.rationale, me(req).id, req.ip, who); } else await applyUnmap(c, ctl, me(req).id, req.ip, who); }
      await c.query('UPDATE mapping_change_requests SET status=?, decided_by=?, decided_at=NOW(3), decision_note=? WHERE id=?', [decision, me(req).id, b.note ?? null, r.id]);
      await audit(c, { actorId: me(req).id, action: `mapping.request_${decision}`, entity: 'control', entityId: r.control_id, detail: { requestId: r.id, requestedBy: r.requested_by }, ip: req.ip });
    });
    return { ok: true };
  };
  app.post('/mapping-requests/:id/approve', { preHandler: adminLevel }, decide('approved')); app.post('/mapping-requests/:id/reject', { preHandler: adminLevel }, decide('rejected')); app.post('/mapping-requests/:id/withdraw', { preHandler: adminLevel }, decide('withdrawn'));
  app.get('/controls/:controlId/mapping-history', { preHandler: adminLevel }, async (req: any) =>
    q(pool, 'SELECT h.id,h.action,h.common_control_id,h.previous_common_control_id,h.rationale,h.created_at,u.name actor FROM control_mapping_history h JOIN users u ON u.id=h.actor_id WHERE h.control_id=? ORDER BY h.id', [req.params.controlId]));
}
