// Creating notifications. Called from inside the action's own transaction, so a notification exists exactly when the thing it announces happened.
// It never throws into the caller: a notification problem must not undo an audit finding or an evidence review.
import type { Conn } from '../../db'; import * as t from '../tenancy/data'; import * as n from './data'; import { cleanLabel, isKind, pickRecipients, emailDefault } from './kinds'; import { emit } from '../../platform/outbox';
export type Notice = { tenantId: string; kind: string; recipients: (string | null | undefined)[]; actorId: string | null; entityType: n.NewNote['entityType']; entityId: string; engagementId: string | null; label: string };
export async function notify(c: Conn, x: Notice): Promise<number> {
  try {
    if (!isKind(x.kind)) return 0; const ids = [...new Set(x.recipients.filter((u): u is string => !!u && u !== x.actorId))]; if (!ids.length) return 0;
    const off = await n.usersWhoDisabled(c, ids, x.kind); let added = 0;
    for (const userId of pickRecipients(ids, x.actorId, off)) {
      if (!(await t.resolveAccess(c, userId, x.tenantId))) continue;          // only people who can still enter this organization
      const id = await n.insertUnlessUnread(c, { tenantId: x.tenantId, userId, kind: x.kind, entityType: x.entityType, entityId: x.entityId, engagementId: x.engagementId, label: cleanLabel(x.label), actorId: x.actorId });
      if (id) { added++; await emit(c, { tenantId: x.tenantId, type: 'notification.created', payload: { notificationId: id, emailDefault: emailDefault(x.kind) }, dedupeKey: `n:${id}` }); }   // the worker decides about email
    }
    return added;
  } catch (e: any) { console.error(JSON.stringify({ level: 'error', msg: 'notification failed', err: e?.message })); return 0; }
}
