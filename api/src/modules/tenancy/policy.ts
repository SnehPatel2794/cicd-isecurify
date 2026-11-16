// Pure authorization rules (no I/O) so they can be unit-tested exhaustively.
import { CLIENT_ROLES, type ClientRole } from './data';
export type Actor = { kind: 'platform_admin' } | { kind: 'staff_manager' } | { kind: 'client_admin' } | { kind: 'none' };
const BASIC: ClientRole[] = ['client_staff', 'third_party_vendor'];
export const rolesActorMayAssign = (a: Actor): ClientRole[] => a.kind === 'client_admin' ? BASIC : a.kind === 'none' ? [] : [...CLIENT_ROLES];
/** Can `a` change the role of an existing member (from -> to)? client_admin may only move people between staff and vendor. */
export const mayChangeRole = (a: Actor, from: ClientRole, to: ClientRole) => a.kind === 'client_admin' ? BASIC.includes(from) && BASIC.includes(to) : a.kind !== 'none';
export const mayRemoveMember = (a: Actor, role: ClientRole) => a.kind === 'client_admin' ? BASIC.includes(role) : a.kind !== 'none';

export type PlatformRole = 'super_admin' | 'admin' | 'isecurify_team' | 'none';
/** Escalation guard: which platform roles may `actor` grant? */
export const platformRolesGrantableBy = (actor: PlatformRole): PlatformRole[] => actor === 'super_admin' ? ['super_admin', 'admin', 'isecurify_team'] : actor === 'admin' ? ['isecurify_team'] : [];
/** May `actor` modify (change role, disable, delete) a user whose platform role is `target`? Nobody touches themselves through these paths. */
export const mayModifyUser = (actor: PlatformRole, target: PlatformRole) => actor === 'super_admin' || (actor === 'admin' && (target === 'none' || target === 'isecurify_team'));
