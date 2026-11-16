// Pure rules for tasks (Phase 13B): statuses, who may do what, reading a task spreadsheet, and working out dates from durations and dependencies.
import { readGrid } from '../frameworks/importer'; import { HttpError } from '../../platform/errors';
export const STATUSES = ['not_started', 'in_progress', 'waiting', 'blocked', 'done', 'cancelled'] as const; export type TStatus = typeof STATUSES[number];
export const STATUS_LABEL: Record<TStatus, string> = { not_started: 'Not started', in_progress: 'In progress', waiting: 'Waiting on client', blocked: 'Blocked', done: 'Done', cancelled: 'Cancelled' };
export const PRIORITIES = ['low', 'normal', 'high'] as const; export type Priority = typeof PRIORITIES[number];
export const PHASE_NAMES = ['Preparation', 'Scheduling', 'Audit Meeting', 'Follow-up', 'Closure'];
export const MAX_TASKS = 500; export const MAX_PER_ENGAGEMENT = 3000;
export const taskRef = (n: number) => `T-${String(n).padStart(3, '0')}`;
export const isOpen = (s: string) => s !== 'done' && s !== 'cancelled';
export type Acc = { via: string; role: string; manage: boolean };
/** Sees every task of the engagement: iSecurify staff, client administrators and the third-party auditor. Client staff and vendors see only tasks assigned to them. */
export const seesAll = (a: Acc) => a.via === 'staff' || a.role === 'client_admin' || a.role === 'tp_auditor';
/** Creates, assigns, edits, reorders and cancels: managing iSecurify staff and client administrators. */
export const canManage = (a: Acc) => (a.via === 'staff' && !!a.manage) || a.role === 'client_admin';
/** Imports a plan or applies a template: managing iSecurify staff only. */
export const canPlan = (a: Acc) => a.via === 'staff' && !!a.manage;
export const canWork = (a: Acc, t: { assigneeId: string | null }, userId: string) => canManage(a) || (a.role !== 'tp_auditor' && t.assigneeId === userId);
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const dayOf = (s: string) => new Date(s + 'T00:00:00.000Z');
const weekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
const nextWorkday = (s: string) => { const d = dayOf(s); do d.setUTCDate(d.getUTCDate() + 1); while (weekend(d)); return isoDay(d); };
const onWorkday = (s: string) => { const d = dayOf(s); while (weekend(d)) d.setUTCDate(d.getUTCDate() + 1); return isoDay(d); };
/** WORKDAY(start, n): n working days after start (n = 0 is start itself). */
export const addWorkdays = (s: string, n: number) => { const d = dayOf(s); let left = n; while (left > 0) { d.setUTCDate(d.getUTCDate() + 1); if (!weekend(d)) left--; } return isoDay(d); };
/** Dates from durations (working days) and dependencies. A task with no dependency starts on `start` (or the next working day); otherwise the working day after the latest end of its dependencies. A task of 0 days is a milestone on its start day. */
export function schedule(rows: { key: string; days: number; deps: string[] }[], start: string): Map<string, { start: string; due: string }> | { error: string } {
  const by = new Map(rows.map(r => [r.key, r])); const out = new Map<string, { start: string; due: string }>(); const state = new Map<string, 1 | 2>();
  const visit = (k: string): string | null => { if (out.has(k)) return null; if (state.get(k) === 1) return `Dependencies form a loop at "${k}"`; state.set(k, 1); const r = by.get(k)!; let s = onWorkday(start);
    if (r.deps.length) { let latest = ''; for (const d of r.deps) { const e = visit(d); if (e) return e; const dd = out.get(d)!.due; if (dd > latest) latest = dd; } s = nextWorkday(latest); }
    out.set(k, { start: s, due: r.days <= 1 ? s : addWorkdays(s, r.days - 1) }); state.set(k, 2); return null; };
  for (const r of rows) { const e = visit(r.key); if (e) return { error: e }; } return out;
}
/** True when adding the edges (task -> deps) to the existing ones creates a loop. */
export function wouldLoop(existing: { taskId: string; dependsOnId: string }[], taskId: string, deps: string[]): boolean {
  const g = new Map<string, string[]>(); for (const e of existing) if (e.taskId !== taskId) (g.get(e.taskId) ?? g.set(e.taskId, []).get(e.taskId)!).push(e.dependsOnId); g.set(taskId, deps);
  const seen = new Set<string>(); const stack = [...deps]; while (stack.length) { const x = stack.pop()!; if (x === taskId) return true; if (seen.has(x)) continue; seen.add(x); stack.push(...(g.get(x) ?? [])); } return false;
}
// ------------------------------------------------------------------ reading a spreadsheet
export type TRow = { row: number; data: { ref: string; stage: string | null; phase: number | null; title: string; description: string | null; ownerHint: string | null; days: number; deps: string[]; priority: Priority }; errors: string[] };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIAS: Record<string, string[]> = { ref: ['ref', 'refno', 'id', 'taskid', 'no', 'number'], stage: ['stage', 'group', 'section', 'workstream'], phase: ['phase', 'platformphase', 'engagementphase'], title: ['task', 'title', 'taskname', 'activity'], description: ['what', 'whatitis', 'description', 'details', 'outcome'], how: ['how', 'howitisdone', 'steps'], owner: ['responsible', 'owner', 'ownerhint', 'who', 'assignedrole', 'role'], days: ['days', 'duration', 'durationdays', 'workingdays'], dep1: ['dependson', 'depends', 'predecessor', 'predecessors'], dep2: ['alsodependson', 'dependson2', 'predecessor2'], priority: ['priority'] };
const fieldFor = (h: string) => { const n = norm(h.replace(/\(.*?\)/g, '')); return Object.keys(ALIAS).find(k => ALIAS[k].includes(n)) ?? null; };
const looksLikeFormula = (s: string) => /^[=+\-@]/.test(s.trim()) && !/^[-+]?\d+(\.\d+)?$/.test(s.trim());
export async function parseTasks(filename: string, buf: Buffer): Promise<{ format: string; headerRow: number; rows: TRow[]; blank: number }> {
  const { grid, ext } = await readGrid(filename, buf); let h = -1; let cols: Record<string, number> = {};
  for (let r = 0; r < Math.min(10, grid.length) && h < 0; r++) { const m: Record<string, number> = {}; grid[r].forEach((c, i) => { const f = fieldFor(c); if (f && m[f] === undefined) m[f] = i; }); if (m.title !== undefined && (m.ref !== undefined || m.days !== undefined)) { h = r; cols = m; } }
  if (h < 0) throw new HttpError(422, 'Could not find a header row with a "Task" column (and "Ref" or "Days") in the first 10 rows');
  const g = (line: string[], f: string) => cols[f] === undefined ? '' : (line[cols[f]] ?? '').toString().trim(); const rows: TRow[] = []; const seen = new Set<string>(); let blank = 0;
  for (let r = h + 1; r < grid.length; r++) { const line = grid[r]; if (!line || line.every(c => !String(c ?? '').trim())) { blank++; continue; }
    const errors: string[] = []; for (const f of Object.keys(cols)) { const raw = g(line, f); if (raw && looksLikeFormula(raw)) errors.push(`${f} starts with = + - or @ (formulas are not accepted)`); }
    const title = g(line, 'title'); if (!title) errors.push('task is empty'); else if (title.length > 300) errors.push('task is longer than 300 characters');
    const ref = g(line, 'ref'); if (ref.length > 60) errors.push('ref is longer than 60 characters'); if (ref) { if (seen.has(norm(ref))) errors.push(`duplicate ref "${ref}"`); seen.add(norm(ref)); }
    const ph = g(line, 'phase'); let phase: number | null = null; if (ph && !['-', 'none', 'na', 'n/a'].includes(ph.toLowerCase())) { const n = /^\d+$/.test(ph) ? Number(ph) : PHASE_NAMES.findIndex(p => norm(p) === norm(ph)) + 1; if (n >= 1 && n <= 5) phase = n; else errors.push(`phase "${ph}" is not 1 to 5 or one of: ${PHASE_NAMES.join(', ')}`); }
    const dr = g(line, 'days'); let days = 1; if (dr) { if (!/^\d+$/.test(dr) || Number(dr) > 400) errors.push(`days "${dr}" must be a whole number from 0 to 400`); else days = Number(dr); }
    const pr = g(line, 'priority').toLowerCase(); let priority: Priority = 'normal'; if (pr) { if ((PRIORITIES as readonly string[]).includes(pr)) priority = pr as Priority; else errors.push(`priority "${pr}" must be low, normal or high`); }
    const deps = [g(line, 'dep1'), g(line, 'dep2')].flatMap(x => x.split(/[,;|]/)).map(x => x.trim()).filter(Boolean); if (deps.length && !ref) errors.push('a task that others or itself depend on needs a ref');
    const what = g(line, 'description'), how = g(line, 'how'); const description = [what, how ? `How: ${how}` : ''].filter(Boolean).join('\n') || null; if (description && description.length > 5000) errors.push('description is longer than 5000 characters');
    rows.push({ row: r + 1, data: { ref, stage: g(line, 'stage').slice(0, 190) || null, phase, title, description, ownerHint: g(line, 'owner').slice(0, 190) || null, days, deps, priority }, errors }); }
  const refs = new Map(rows.filter(x => x.data.ref).map(x => [norm(x.data.ref), x.data.ref]));
  for (const x of rows) { x.data.deps = x.data.deps.map(d => { const hit = refs.get(norm(d)); if (!hit) x.errors.push(`depends on "${d}", which is not in the file`); else if (norm(hit) === norm(x.data.ref)) x.errors.push('depends on itself'); return hit ?? d; }); }
  if (rows.length > MAX_TASKS) throw new HttpError(422, `The file has more than ${MAX_TASKS} tasks`);
  if (!rows.some(x => x.errors.length)) { const s = schedule(rows.map(x => ({ key: x.data.ref || `#${x.row}`, days: x.data.days, deps: x.data.deps })), '2026-01-05'); if ('error' in s) rows[0].errors.push(s.error); }
  return { format: ext, headerRow: h + 1, rows, blank };
}
