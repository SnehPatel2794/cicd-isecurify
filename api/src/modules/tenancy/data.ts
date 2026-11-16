// TENANT-SCOPED DATA LAYER. This file (plus modules/audit/data.ts and platform/audit.ts) is the ONLY place allowed to run SQL on
// tenant-owned tables (memberships, staff_assignments, invitations, audit_events). Every function takes the tenantId explicitly;
// there is deliberately no function that reads these tables across tenants except the user-centric ones that are named as such.
// test/05_data_layer.test.ts fails if any other file queries those tables.
import { q, type Conn } from '../../db';

export type Access = { via: 'member' | 'staff'; role: string; manage: boolean; readEvidence: boolean; orgStatus: string };
export const CLIENT_ROLES = ['client_admin', 'client_staff', 'third_party_vendor', 'tp_auditor'] as const;
export type ClientRole = typeof CLIENT_ROLES[number];

export async function getOrg(c: Conn, id: string) { return (await q(c, 'SELECT id,name,domain,status,retention_months,created_at FROM organizations WHERE id=?', [id]))[0] ?? null; }

/** Returns what `userId` may do in ONE tenant, or null if they have no membership and no active staff assignment (callers answer 404). */
export async function resolveAccess(c: Conn, userId: string, tenantId: string): Promise<Access | null> {
  const org = await getOrg(c, tenantId); if (!org) return null;
  const m = (await q(c, 'SELECT role FROM memberships WHERE tenant_id=? AND user_id=?', [tenantId, userId]))[0];
  if (m) return { via: 'member', role: m.role, manage: m.role === 'client_admin', readEvidence: m.role === 'client_admin' || m.role === 'tp_auditor', orgStatus: org.status };
  const s = (await q(c, `SELECT can_manage, can_read_evidence FROM staff_assignments WHERE tenant_id=? AND user_id=? AND (expires_at IS NULL OR expires_at>NOW(3))`, [tenantId, userId]))[0];
  if (s) return { via: 'staff', role: 'isecurify_staff', manage: !!s.can_manage, readEvidence: !!s.can_read_evidence, orgStatus: org.status };
  return null;
}
/** User-centric: the organizations this user can enter (memberships + active staff assignments). */
export async function listAccessibleOrgs(c: Conn, userId: string) {
  return q(c, `SELECT o.id, o.name, o.status, 'member' AS via, m.role AS role FROM memberships m JOIN organizations o ON o.id=m.tenant_id WHERE m.user_id=?
    UNION ALL SELECT o.id, o.name, o.status, 'staff', 'isecurify_staff' FROM staff_assignments s JOIN organizations o ON o.id=s.tenant_id WHERE s.user_id=? AND (s.expires_at IS NULL OR s.expires_at>NOW(3)) ORDER BY name`, [userId, userId]);
}
export const countUserMemberships = async (c: Conn, userId: string) => (await q(c, 'SELECT COUNT(*) n FROM memberships WHERE user_id=?', [userId]))[0].n as number;
export const listUserMemberships = (c: Conn, userId: string) => q(c, 'SELECT o.id org_id, o.name org_name, m.role FROM memberships m JOIN organizations o ON o.id=m.tenant_id WHERE m.user_id=? ORDER BY o.name', [userId]);
export const listUserStaffAssignments = (c: Conn, userId: string) => q(c, 'SELECT o.id org_id, o.name org_name, s.expires_at FROM staff_assignments s JOIN organizations o ON o.id=s.tenant_id WHERE s.user_id=?', [userId]);
export const deleteUserStaffAssignments = async (c: Conn, userId: string) => { await c.query('DELETE FROM staff_assignments WHERE user_id=?', [userId]); };
export const revokeUserInvitations = async (c: Conn, email: string) => { await c.query('UPDATE invitations SET revoked_at=NOW(3) WHERE email=? AND accepted_at IS NULL AND revoked_at IS NULL', [email]); };

// ---- members (always tenant-scoped; deleted accounts are hidden) ----
export const listMembers = (c: Conn, tenantId: string) => q(c, `SELECT u.id, u.name, u.email, u.status, m.role, m.created_at FROM memberships m JOIN users u ON u.id=m.user_id
  WHERE m.tenant_id=? AND u.status<>'deleted' ORDER BY u.name`, [tenantId]);
export const getMember = async (c: Conn, tenantId: string, userId: string) => (await q(c, `SELECT u.id,u.email,u.name,u.status,u.platform_role,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.user_id=? AND u.status<>'deleted'`, [tenantId, userId]))[0] ?? null;
export const addMember = async (c: Conn, tenantId: string, userId: string, role: ClientRole) => { await c.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES (?,?,?)', [tenantId, userId, role]); };
export const setMemberRole = async (c: Conn, tenantId: string, userId: string, role: ClientRole) => { await c.query('UPDATE memberships SET role=? WHERE tenant_id=? AND user_id=?', [role, tenantId, userId]); };
export const removeMember = async (c: Conn, tenantId: string, userId: string) => { await c.query('DELETE FROM memberships WHERE tenant_id=? AND user_id=?', [tenantId, userId]); };
export const countMembers = async (c: Conn, tenantId: string, role?: ClientRole) => (await q(c, `SELECT COUNT(*) n FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND u.status='active' ${role ? 'AND m.role=?' : ''}`, role ? [tenantId, role] : [tenantId]))[0].n as number;
export const memberCountsByOrg = (c: Conn) => q(c, "SELECT m.tenant_id, COUNT(*) n FROM memberships m JOIN users u ON u.id=m.user_id WHERE u.status<>'deleted' GROUP BY m.tenant_id");

// ---- staff assignments ----
export const upsertStaff = async (c: Conn, tenantId: string, userId: string, o: { canManage: boolean; canReadEvidence: boolean; expiresAt: Date | null; grantedBy: string }) => {
  await c.query(`INSERT INTO staff_assignments(tenant_id,user_id,can_manage,can_read_evidence,expires_at,granted_by) VALUES (?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE can_manage=VALUES(can_manage), can_read_evidence=VALUES(can_read_evidence), expires_at=VALUES(expires_at), granted_by=VALUES(granted_by)`, [tenantId, userId, o.canManage, o.canReadEvidence, o.expiresAt, o.grantedBy]); };
export const removeStaff = async (c: Conn, tenantId: string, userId: string) => ((await c.query('DELETE FROM staff_assignments WHERE tenant_id=? AND user_id=?', [tenantId, userId]))[0] as any).affectedRows as number;
export const listStaff = (c: Conn, tenantId: string) => q(c, 'SELECT u.id, u.name, u.email, s.can_manage, s.can_read_evidence, s.expires_at, s.created_at FROM staff_assignments s JOIN users u ON u.id=s.user_id WHERE s.tenant_id=? AND u.status<>\'deleted\' ORDER BY u.name', [tenantId]);

// ---- invitations ----
export const hasPendingInvite = async (c: Conn, tenantId: string | null, email: string) => ((await q(c, 'SELECT 1 x FROM invitations WHERE tenant_id <=> ? AND email=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>NOW(3) FOR UPDATE', [tenantId, email]))[0]) !== undefined;
export const createInvitation = async (c: Conn, i: { id: string; tenantId: string | null; kind: 'tenant' | 'platform'; email: string; role: string; tokenHash: string; invitedBy: string; expiresAt: Date }) => {
  await c.query('INSERT INTO invitations(id,tenant_id,kind,email,role,token_hash,invited_by,expires_at) VALUES (?,?,?,?,?,?,?,?)', [i.id, i.tenantId, i.kind, i.email, i.role, i.tokenHash, i.invitedBy, i.expiresAt]); };
export const listInvitations = (c: Conn, tenantId: string) => q(c, `SELECT id,email,role,expires_at,created_at,invited_by FROM invitations WHERE tenant_id=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>NOW(3) ORDER BY created_at DESC`, [tenantId]);
export const getInvitationInTenant = async (c: Conn, tenantId: string, id: string) => (await q(c, 'SELECT * FROM invitations WHERE tenant_id=? AND id=? AND accepted_at IS NULL AND revoked_at IS NULL', [tenantId, id]))[0] ?? null;
export const revokeInvitation = async (c: Conn, tenantId: string, id: string) => { await c.query('UPDATE invitations SET revoked_at=NOW(3) WHERE tenant_id=? AND id=?', [tenantId, id]); };
export const findInvitationByTokenHash = async (c: Conn, hash: string, lock = false) => (await q(c, `SELECT i.*, o.name org_name, o.status org_status FROM invitations i LEFT JOIN organizations o ON o.id=i.tenant_id
  WHERE i.token_hash=? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>NOW(3) ${lock ? 'FOR UPDATE' : ''}`, [hash]))[0] ?? null;
export const markInvitationAccepted = async (c: Conn, id: string) => { await c.query('UPDATE invitations SET accepted_at=NOW(3) WHERE id=?', [id]); };

// ---- platform user directory (user-centric; joins membership counts only) ----
export async function listUsersWithOrgCounts(c: Conn, f: { q?: string; status?: string; limit: number }) {
  const w: string[] = []; const p: any[] = [];
  if (f.status) { w.push('u.status=?'); p.push(f.status); } else w.push("u.status<>'deleted'");
  if (f.q) { w.push('(u.email LIKE ? OR u.name LIKE ?)'); { const like = `%${f.q.replace(/[\\%_]/g, c => '\\' + c)}%`; p.push(like, like); } }
  return q(c, `SELECT u.id,u.name,u.email,u.status,u.platform_role platformRole,u.created_at createdAt,(SELECT COUNT(*) FROM memberships m WHERE m.user_id=u.id) orgCount FROM users u WHERE ${w.join(' AND ')} ORDER BY u.name LIMIT ?`, [...p, f.limit]);
}
