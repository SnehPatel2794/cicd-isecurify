import { purgeUser as purgeNotifications } from '../notifications/data';
import PDFDocument from 'pdfkit';
import { q, tx, type Pool, type Conn } from '../../db';
import { audit } from '../../platform/audit'; import { uuid } from '../../platform/crypto';
import { HttpError, bad, forbidden, notFound, conflict } from '../../platform/errors';
import { mayModifyUser, type PlatformRole } from '../tenancy/policy';
import { listUserMemberships, listUserStaffAssignments, deleteUserStaffAssignments, revokeUserInvitations } from '../tenancy/data';
import { countUserAuditEvents, recentUserAuditActions, hasRecentBackupEvent } from '../audit/data';
import { collectBlockers, manifestProviders } from './hooks';

export const getUser = async (c: Conn, id: string) => (await q(c, 'SELECT id,email,name,status,platform_role,created_at FROM users WHERE id=?', [id]))[0] ?? null;

export async function deletionSummary(c: Conn, userId: string) {
  const u = await getUser(c, userId); if (!u) throw notFound();
  const [memberships, staff, auditCount, blockers] = await Promise.all([listUserMemberships(c, userId), listUserStaffAssignments(c, userId), countUserAuditEvents(c, userId), collectBlockers(c, userId)]);
  return { user: { id: u.id, name: u.name, email: u.email, status: u.status, platformRole: u.platform_role }, memberships, staffAssignments: staff, auditEvents: auditCount, blockers, canDelete: blockers.length === 0 && u.status !== 'deleted' };
}

export async function buildManifestPdf(c: Conn, userId: string): Promise<Buffer> {
  const u = await getUser(c, userId); if (!u) throw notFound();
  const memberships = await listUserMemberships(c, userId); const staff = await listUserStaffAssignments(c, userId); const actions = await recentUserAuditActions(c, userId);
  const sections = [];
  for (const p of manifestProviders) sections.push(await p(c, userId));
  const doc = new PDFDocument({ margin: 50, info: { Title: `Account data manifest - ${u.name}` } }); const chunks: Buffer[] = []; doc.on('data', (d: Buffer) => chunks.push(d));
  const done = new Promise<Buffer>(r => doc.on('end', () => r(Buffer.concat(chunks))));
  const h = (t: string) => { doc.moveDown().fontSize(12).fillColor('#222').text(t, { underline: true }).moveDown(0.3).fontSize(9).fillColor('#333'); };
  const table = (headers: string[], rows: string[][]) => { if (!rows.length) { doc.text('None recorded.'); return; } doc.text(headers.join('  |  ')); for (const r of rows) doc.text(r.join('  |  ')); };
  doc.fontSize(16).text('Account data manifest'); doc.fontSize(9).fillColor('#555').text(`Generated ${new Date().toISOString()} - confidential`);
  h('Account'); doc.text(`Name: ${u.name}\nEmail: ${u.email}\nStatus: ${u.status}\nPlatform role: ${u.platform_role}\nCreated: ${new Date(u.created_at).toISOString()}`);
  h('Organization memberships'); table(['Organization', 'Role'], memberships.map(m => [m.org_name, m.role]));
  h('iSecurify staff assignments'); table(['Organization', 'Expires'], staff.map(s => [s.org_name, s.expires_at ? new Date(s.expires_at).toISOString() : 'never']));
  for (const s of sections) { h(s.title); table(s.headers, s.rows); }
  if (!manifestProviders.length) { h('Evidence uploads, comments and findings'); doc.text('No evidence, comment or finding modules are installed in this build; sections appear here once they exist.'); }
  h(`Recent activity (${actions.length} most recent actions)`); table(['When', 'Action'], actions.map(a => [new Date(a.created_at).toISOString(), a.action]));
  doc.end(); return done;
}

export type DeleteOpts = { actor: { id: string; platformRole: PlatformRole }; targetId: string; reason?: string; withoutBackup?: boolean; confirmEmail?: string; ip?: string };
/** Soft delete: the row stays so evidence, comments and audit history keep their foreign keys. PII is removed from the account itself. */
export async function softDeleteUser(pool: Pool, o: DeleteOpts) {
  return tx(pool, async (c) => {
    const u = (await q(c, 'SELECT * FROM users WHERE id=? FOR UPDATE', [o.targetId]))[0]; if (!u) throw notFound();
    if (u.status === 'deleted') throw conflict('User is already deleted');
    if (u.id === o.actor.id) throw bad('You cannot delete your own account');
    if (!mayModifyUser(o.actor.platformRole, u.platform_role)) throw forbidden('Not allowed to delete this user');
    if (u.platform_role === 'super_admin') {
      const n = (await q(c, "SELECT COUNT(*) n FROM users WHERE platform_role='super_admin' AND status='active' AND id<>? FOR UPDATE", [u.id]))[0].n;
      if (n === 0) throw conflict('Cannot delete the last Super Admin');
    }
    const blockers = await collectBlockers(c, u.id); if (blockers.length) throw new HttpError(409, 'User has open items that must be reassigned first', 'has_open_items');
    const backup = await hasRecentBackupEvent(c, o.actor.id, u.id);
    if (!backup && !(o.withoutBackup && o.confirmEmail && o.confirmEmail.toLowerCase() === u.email.toLowerCase())) throw new HttpError(409, 'Download the account backup first, or confirm deletion without a backup by typing the user\'s email', 'backup_required');
    const anon = `deleted-${uuid().slice(0, 8)}@removed.invalid`;
    await c.query("UPDATE users SET status='deleted', deleted_at=NOW(3), email=?, name='Deleted User', password_hash=NULL, failed_logins=0, locked_until=NULL WHERE id=?", [anon, u.id]);
    for (const t of ['sessions', 'mfa_secrets', 'recovery_codes', 'password_resets']) await c.query(`DELETE FROM ${t} WHERE user_id=?`, [u.id]);
    await purgeNotifications(c, u.id); await deleteUserStaffAssignments(c, u.id); await revokeUserInvitations(c, u.email);
    await c.query('INSERT INTO user_deletion_log(deleted_user_id,email_snapshot,name_snapshot,performed_by,backup_taken,reason) VALUES (?,?,?,?,?,?)', [u.id, u.email, u.name, o.actor.id, backup ? 1 : 0, o.reason?.slice(0, 500) ?? null]);
    await audit(c, { actorId: o.actor.id, action: 'user.deleted', entity: 'user', entityId: u.id, detail: { backupTaken: backup, reason: o.reason ?? null }, ip: o.ip });
    return { ok: true, backupTaken: backup };
  });
}
