// Request-scoping helpers shared by the engagement and evidence routes (pure: no SQL here).
import type { Scope } from './data';
/** What part of an organization's engagements a caller may see: client admins and iSecurify staff everything; TP auditors only engagements they belong to; client staff and vendors only their own items. */
export const scopeOf = (access: { via: string; role: string }, userId: string): Scope =>
  access.via === 'staff' || access.role === 'client_admin' ? { kind: 'all' } : access.role === 'tp_auditor' ? { kind: 'auditor', userId } : { kind: 'assigned', userId };
import { HttpError, notFound } from '../../platform/errors'; import { getEngagement } from './data'; import type { Conn } from '../../db';
/** Locks the engagement row and refuses writes to a closed engagement (409 engagement_closed). Lock order used everywhere: item -> engagement -> request. */
export async function writableEngagement(c: Conn, tenantId: string, id: string) {
  const e = await getEngagement(c, tenantId, id, true); if (!e) throw notFound();
  if (e.status === 'closed') throw new HttpError(409, 'This engagement is closed', 'engagement_closed'); return e;
}
/** Extension point: later modules register checks that stop an engagement from being closed. Each returns a reason, or null when closing is fine. */
export const closeBlockers: Array<(c: Conn, tenantId: string, engagementId: string) => Promise<string | null>> = [];
