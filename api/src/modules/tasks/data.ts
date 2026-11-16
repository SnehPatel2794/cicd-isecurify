// TENANT-SCOPED DATA LAYER for tasks. Only this file may run SQL on tasks, task_deps and task_comments (test/05_data_layer.test.ts enforces it).
// Every function takes tenantId and puts it in every WHERE/JOIN. task_templates is global (platform administrators), like questionnaire_versions.
import { q, type Conn } from '../../db'; import { uuid } from '../../platform/crypto';
const D = (col: string, as: string) => `DATE_FORMAT(${col},'%Y-%m-%d') ${as}`;
const COLS = `t.id, t.engagement_id engagementId, t.task_no taskNo, t.ref, t.stage, t.phase, t.title, t.description, t.owner_hint ownerHint, t.assignee_id assigneeId, au.name assigneeName, t.priority, t.status,
  ${D('t.start_date', 'startDate')}, ${D('t.due_date', 'dueDate')}, t.completed_at completedAt, t.created_by createdBy, t.created_at createdAt, t.updated_at updatedAt`;
const FROM = `FROM tasks t LEFT JOIN users au ON au.id=t.assignee_id`;
export type NewTask = { ref: string | null; stage: string | null; phase: number | null; title: string; description: string | null; ownerHint: string | null; assigneeId: string | null; priority: string; startDate: string | null; dueDate: string | null; deps?: string[] };

export const list = (c: Conn, tenantId: string, engagementId: string, o: { assigneeId?: string } = {}) => q(c, `SELECT ${COLS},
  (SELECT COUNT(*) FROM task_comments k WHERE k.tenant_id=t.tenant_id AND k.task_id=t.id) commentCount,
  (SELECT GROUP_CONCAT(d.depends_on_id) FROM task_deps d WHERE d.tenant_id=t.tenant_id AND d.task_id=t.id) depIds
  ${FROM} WHERE t.tenant_id=? AND t.engagement_id=? ${o.assigneeId ? 'AND t.assignee_id=?' : ''} ORDER BY t.task_no`, o.assigneeId ? [tenantId, engagementId, o.assigneeId] : [tenantId, engagementId]).then(r => r.map(x => ({ ...x, depIds: x.depIds ? String(x.depIds).split(',') : [] })));
export const get = async (c: Conn, tenantId: string, id: string, lock = false) => (await q(c, `SELECT ${COLS} ${FROM} WHERE t.tenant_id=? AND t.id=? ${lock ? 'FOR UPDATE' : ''}`, [tenantId, id]))[0] ?? null;
export const depsOf = (c: Conn, tenantId: string, taskId: string) => q(c, `SELECT d.depends_on_id id, t.task_no taskNo, t.title, t.status FROM task_deps d JOIN tasks t ON t.tenant_id=d.tenant_id AND t.id=d.depends_on_id WHERE d.tenant_id=? AND d.task_id=? ORDER BY t.task_no`, [tenantId, taskId]);
export const dependents = (c: Conn, tenantId: string, taskId: string) => q(c, `SELECT d.task_id id, t.task_no taskNo, t.title, t.status FROM task_deps d JOIN tasks t ON t.tenant_id=d.tenant_id AND t.id=d.task_id WHERE d.tenant_id=? AND d.depends_on_id=? ORDER BY t.task_no`, [tenantId, taskId]);
export const edges = (c: Conn, tenantId: string, engagementId: string) => q(c, `SELECT d.task_id taskId, d.depends_on_id dependsOnId FROM task_deps d JOIN tasks t ON t.tenant_id=d.tenant_id AND t.id=d.task_id WHERE d.tenant_id=? AND t.engagement_id=?`, [tenantId, engagementId]);
export const countOf = async (c: Conn, tenantId: string, engagementId: string) => Number((await q(c, 'SELECT COUNT(*) n FROM tasks WHERE tenant_id=? AND engagement_id=?', [tenantId, engagementId]))[0].n);
export const idsIn = async (c: Conn, tenantId: string, engagementId: string, ids: string[]) => ids.length ? (await q(c, `SELECT id FROM tasks WHERE tenant_id=? AND engagement_id=? AND id IN (${ids.map(() => '?').join(',')})`, [tenantId, engagementId, ...ids])).map(r => r.id as string) : [];
export const counts = async (c: Conn, tenantId: string, engagementId: string, today: string) => { const r = (await q(c, `SELECT status, COUNT(*) n, SUM(due_date IS NOT NULL AND due_date < ? AND status NOT IN ('done','cancelled')) overdue FROM tasks WHERE tenant_id=? AND engagement_id=? GROUP BY status`, [today, tenantId, engagementId]));
  const by: Record<string, number> = {}; let overdue = 0, total = 0; for (const x of r) { by[x.status] = Number(x.n); overdue += Number(x.overdue ?? 0); total += Number(x.n); } return { total, overdue, byStatus: by }; };
/** Open tasks that are past their due date, for the phase check. */
export const overdueCount = async (c: Conn, tenantId: string, engagementId: string, today: string) => Number((await q(c, "SELECT COUNT(*) n FROM tasks WHERE tenant_id=? AND engagement_id=? AND status NOT IN ('done','cancelled') AND due_date IS NOT NULL AND due_date < ?", [tenantId, engagementId, today]))[0].n);
export const openCount = async (c: Conn, tenantId: string, engagementId: string) => Number((await q(c, "SELECT COUNT(*) n FROM tasks WHERE tenant_id=? AND engagement_id=? AND status NOT IN ('done','cancelled')", [tenantId, engagementId]))[0].n);

/** Inserts tasks one after another (task numbers continue from the highest). `deps` hold the ids of earlier rows or ids already in the engagement. Returns the new ids. */
export async function insertMany(c: Conn, tenantId: string, engagementId: string, rows: (NewTask & { key?: string; depKeys?: string[] })[], by: string): Promise<string[]> {
  let no = Number((await q(c, 'SELECT COALESCE(MAX(task_no),0) n FROM tasks WHERE tenant_id=? AND engagement_id=?', [tenantId, engagementId]))[0].n); const ids: string[] = []; const byKey = new Map<string, string>();
  for (const r of rows) { const id = uuid(); no++; ids.push(id); if (r.key) byKey.set(r.key, id);
    await c.query(`INSERT INTO tasks(tenant_id,id,engagement_id,task_no,ref,stage,phase,title,description,owner_hint,assignee_id,priority,status,start_date,due_date,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'not_started',?,?,?)`,
      [tenantId, id, engagementId, no, r.ref, r.stage, r.phase, r.title, r.description, r.ownerHint, r.assigneeId, r.priority, r.startDate, r.dueDate, by]); }
  for (let i = 0; i < rows.length; i++) for (const k of new Set([...(rows[i].depKeys ?? []).map(x => byKey.get(x)).filter(Boolean) as string[], ...(rows[i].deps ?? [])])) await c.query('INSERT INTO task_deps(tenant_id,task_id,depends_on_id) VALUES (?,?,?)', [tenantId, ids[i], k]);
  return ids;
}
const SET: Record<string, string> = { title: 'title', description: 'description', ownerHint: 'owner_hint', assigneeId: 'assignee_id', priority: 'priority', stage: 'stage', phase: 'phase', startDate: 'start_date', dueDate: 'due_date' };
export async function update(c: Conn, tenantId: string, id: string, patch: Record<string, any>, status?: string) {
  const sets: string[] = [], vals: any[] = []; for (const [k, col] of Object.entries(SET)) if (k in patch) { sets.push(`${col}=?`); vals.push(patch[k]); }
  if (status) { sets.push('status=?', 'completed_at=' + (status === 'done' ? 'NOW(3)' : 'NULL')); vals.push(status); }
  if (!sets.length) return; await c.query(`UPDATE tasks SET ${sets.join(', ')} WHERE tenant_id=? AND id=?`, [...vals, tenantId, id]);
}
export async function setDeps(c: Conn, tenantId: string, taskId: string, deps: string[]) { await c.query('DELETE FROM task_deps WHERE tenant_id=? AND task_id=?', [tenantId, taskId]); for (const d of new Set(deps)) await c.query('INSERT INTO task_deps(tenant_id,task_id,depends_on_id) VALUES (?,?,?)', [tenantId, taskId, d]); }
export const comments = (c: Conn, tenantId: string, taskId: string) => q(c, `SELECT k.id, k.body, k.author_id authorId, u.name authorName, k.created_at createdAt FROM task_comments k JOIN users u ON u.id=k.author_id WHERE k.tenant_id=? AND k.task_id=? ORDER BY k.created_at, k.id`, [tenantId, taskId]);
export const addComment = async (c: Conn, tenantId: string, taskId: string, authorId: string, body: string) => { const id = uuid(); await c.query('INSERT INTO task_comments(tenant_id,id,task_id,author_id,body) VALUES (?,?,?,?,?)', [tenantId, id, taskId, authorId, body]); return id; };
/** Open tasks assigned to a person in the organization's active engagements (My work). */
export const openFor = (c: Conn, tenantId: string, userId: string) => q(c, `SELECT ${COLS}, e.name engagementName FROM tasks t JOIN engagements e ON e.tenant_id=t.tenant_id AND e.id=t.engagement_id LEFT JOIN users au ON au.id=t.assignee_id
  WHERE t.tenant_id=? AND t.assignee_id=? AND e.status='active' AND t.status NOT IN ('done','cancelled') ORDER BY t.due_date IS NULL, t.due_date, t.task_no LIMIT 200`, [tenantId, userId]);

// ---- templates (global, platform administrators)
export const templates = (c: Conn, frameworkIds: string[] | null) => q(c, `SELECT t.id, t.name, t.framework_id frameworkId, f.name frameworkName, t.description, t.item_count itemCount, t.source_name sourceName, t.created_at createdAt FROM task_templates t LEFT JOIN frameworks f ON f.id=t.framework_id
  WHERE t.archived_at IS NULL ${frameworkIds ? `AND (t.framework_id IS NULL ${frameworkIds.length ? `OR t.framework_id IN (${frameworkIds.map(() => '?').join(',')})` : ''})` : ''} ORDER BY t.name`, frameworkIds ?? []);
export const template = async (c: Conn, id: string) => { const r = (await q(c, 'SELECT id, name, framework_id frameworkId, description, items, item_count itemCount FROM task_templates WHERE id=? AND archived_at IS NULL', [id]))[0]; return r ? { ...r, items: JSON.parse(r.items) } : null; };
export const saveTemplate = async (c: Conn, o: { name: string; frameworkId: string | null; description: string | null; items: any[]; sourceName: string; sha256: string; by: string }) => { const id = uuid(); await c.query('INSERT INTO task_templates(id,name,framework_id,description,items,item_count,source_name,sha256,created_by) VALUES (?,?,?,?,?,?,?,?,?)', [id, o.name, o.frameworkId, o.description, JSON.stringify(o.items), o.items.length, o.sourceName, o.sha256, o.by]); return id; };
export const archiveTemplate = async (c: Conn, id: string) => ((await c.query('UPDATE task_templates SET archived_at=NOW(3) WHERE id=? AND archived_at IS NULL', [id])) as any)[0].affectedRows as number;
export const frameworkIdsOf = async (c: Conn, tenantId: string, engagementId: string) => (await q(c, 'SELECT framework_id id FROM engagement_frameworks WHERE tenant_id=? AND engagement_id=?', [tenantId, engagementId])).map(r => r.id as string);

// ---- dashboards (read-only aggregates over one or many engagements)
const IN = (n: number) => Array(n).fill('?').join(',');
const OPEN = "t.status NOT IN ('done','cancelled')";
/** Task figures for a set of engagements: status counts, overdue, who carries the load, progress per phase and per engagement. */
export async function facts(c: Conn, tenantId: string, engIds: string[], today: string) {
  const empty = { total: 0, open: 0, done: 0, overdue: 0, dueThisWeek: 0, unassigned: 0, byStatus: {} as Record<string, number>, byAssignee: [] as any[], byPhase: [] as any[], byEngagement: {} as Record<string, { open: number; overdue: number; done: number; total: number }> };
  if (!engIds.length) return empty; const w = `t.tenant_id=? AND t.engagement_id IN (${IN(engIds.length)})`; const base = [tenantId, ...engIds];
  const [st, who, ph, eng] = await Promise.all([
    q(c, `SELECT t.status, COUNT(*) n, SUM(${OPEN} AND t.due_date IS NOT NULL AND t.due_date < ?) late, SUM(${OPEN} AND t.due_date >= ? AND t.due_date <= DATE_ADD(?, INTERVAL 7 DAY)) soon, SUM(${OPEN} AND t.assignee_id IS NULL) unassigned FROM tasks t WHERE ${w} GROUP BY t.status`, [today, today, today, ...base]),
    q(c, `SELECT t.assignee_id id, u.name, COUNT(*) open, SUM(t.due_date IS NOT NULL AND t.due_date < ?) late FROM tasks t JOIN users u ON u.id=t.assignee_id WHERE ${w} AND ${OPEN} GROUP BY t.assignee_id, u.name ORDER BY late DESC, open DESC, u.name LIMIT 12`, [today, ...base]),
    q(c, `SELECT t.phase, SUM(t.status='done') done, SUM(${OPEN}) open FROM tasks t WHERE ${w} AND t.phase IS NOT NULL GROUP BY t.phase ORDER BY t.phase`, base),
    q(c, `SELECT t.engagement_id id, COUNT(*) total, SUM(${OPEN}) open, SUM(t.status='done') done, SUM(${OPEN} AND t.due_date IS NOT NULL AND t.due_date < ?) late FROM tasks t WHERE ${w} GROUP BY t.engagement_id`, [today, ...base]),
  ]);
  const o = { ...empty, byStatus: {} as Record<string, number>, byEngagement: {} as Record<string, any> };
  for (const r of st) { o.byStatus[r.status] = Number(r.n); o.total += Number(r.n); o.overdue += Number(r.late ?? 0); o.dueThisWeek += Number(r.soon ?? 0); o.unassigned += Number(r.unassigned ?? 0); }
  o.done = o.byStatus.done ?? 0; o.open = o.total - o.done - (o.byStatus.cancelled ?? 0);
  o.byAssignee = who.map(r => ({ id: r.id, name: r.name, open: Number(r.open), overdue: Number(r.late ?? 0) })); o.byPhase = ph.map(r => ({ phase: Number(r.phase), done: Number(r.done ?? 0), open: Number(r.open ?? 0) }));
  for (const r of eng) o.byEngagement[r.id] = { total: Number(r.total), open: Number(r.open ?? 0), done: Number(r.done ?? 0), overdue: Number(r.late ?? 0) };
  return o;
}
/** Open tasks that are overdue (kind 'overdue') or due in the next days (kind 'soon'), most urgent first. */
export const urgent = (c: Conn, tenantId: string, engIds: string[], today: string, kind: 'overdue' | 'soon', limit = 12) => !engIds.length ? Promise.resolve([] as any[]) : q(c,
  `SELECT t.id, t.engagement_id engagementId, e.name engagementName, t.task_no taskNo, t.title, ${D('t.due_date', 'dueDate')}, t.priority, t.status, t.assignee_id assigneeId, au.name assigneeName
   FROM tasks t JOIN engagements e ON e.tenant_id=t.tenant_id AND e.id=t.engagement_id LEFT JOIN users au ON au.id=t.assignee_id
   WHERE t.tenant_id=? AND t.engagement_id IN (${IN(engIds.length)}) AND ${OPEN} AND t.due_date IS NOT NULL AND ${kind === 'overdue' ? 't.due_date < ?' : 't.due_date >= ? AND t.due_date <= DATE_ADD(?, INTERVAL 14 DAY)'}
   ORDER BY t.due_date, t.task_no LIMIT ${Number(limit)}`, kind === 'overdue' ? [tenantId, ...engIds, today] : [tenantId, ...engIds, today, today]);
