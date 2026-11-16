// Task reminders (Phase 13B): the assignee hears once when a task is due within two days and once when it is overdue.
import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import crypto from 'node:crypto';
import { freshDb } from './helpers'; import { runTaskReminders, label } from '../src/tasks';
let db: Awaited<ReturnType<typeof freshDb>>; const uid = () => crypto.randomUUID(); const T = uid(), U = uid(), V = uid(), E = uid();
const days = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10); const q = async (s: string, p: any[] = []) => ((await db.pool.query(s, p)) as any)[0] as any[];
const log = { info: () => {}, warn: () => {} }; const run = () => runTaskReminders(db.pool, new Date(), log);
const task = (no: number, title: string, due: string | null, status = 'not_started', who: string | null = V) => q("INSERT INTO tasks(tenant_id,id,engagement_id,task_no,title,assignee_id,status,due_date,completed_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)", [T, uid(), E, no, title, who, status, due, status === 'done' ? new Date() : null, U]);
before(async () => { db = await freshDb(); await q("INSERT INTO users(id,email,name) VALUES (?,?,?),(?,?,?)", [U, 'u@x.test', 'U', V, 'v@x.test', 'V']); await q("INSERT INTO organizations(id,name) VALUES (?,?)", [T, 'Acme']); await q("INSERT INTO memberships(tenant_id,user_id,role) VALUES (?,?,'client_staff')", [T, V]); await q("INSERT INTO engagements(tenant_id,id,name,status,created_by) VALUES (?,?,?,'active',?)", [T, E, 'E', U]); });
after(() => db.close());
test('wording', () => { assert.match(label(7, 'Enable MFA', days(0), 'due_soon', days(0)), /^T-007 Enable MFA is due today$/); assert.match(label(7, 'Enable MFA', '2026-01-01', 'overdue', days(0)), /was due 2026-01-01/); });
test('due soon and overdue each notify the assignee once; running again adds nothing; later tasks, done tasks and unassigned tasks stay silent', async () => {
  await task(1, 'Soon', days(2)); await task(2, 'Late', days(-3)); await task(3, 'Far', days(10)); await task(4, 'Done', days(-3), 'done'); await task(5, 'Cancelled', days(-3), 'cancelled'); await task(6, 'Nobody', days(-3), 'not_started', null); await task(7, 'No date', null);
  const r = await run(); assert.equal(r.notices, 2); assert.equal((await q("SELECT COUNT(*) n FROM notifications WHERE kind='task.due' AND user_id=?", [V]))[0].n, 2); assert.equal((await run()).notices, 0);
  const labels = (await q("SELECT label FROM notifications WHERE kind='task.due' ORDER BY label")).map(x => x.label); assert.ok(labels.some(l => /T-001 Soon is due/.test(l))); assert.ok(labels.some(l => /T-002 Late was due/.test(l)));
});
test('a task that was soon becomes overdue: one more notice; people who switched the kind off, closed engagements and disabled users get nothing', async () => {
  await q("UPDATE tasks SET due_date=? WHERE task_no=1", [days(-1)]); assert.equal((await run()).notices, 1);
  await q("DELETE FROM notifications"); await q("DELETE FROM task_notice_log"); await q("INSERT INTO notification_prefs(user_id,kind,in_app) VALUES (?,?,0)", [V, 'task.due']); assert.equal((await run()).notices, 0); await q("DELETE FROM notification_prefs"); await q("DELETE FROM task_notice_log");
  await q("UPDATE engagements SET status='closed', closed_at=NOW(3) WHERE id=?", [E]); assert.equal((await run()).tasks, 0); await q("UPDATE engagements SET status='active', closed_at=NULL WHERE id=?", [E]);
  await q("UPDATE users SET status='disabled' WHERE id=?", [V]); assert.equal((await run()).tasks, 0); await q("UPDATE users SET status='active' WHERE id=?", [V]); await q("DELETE FROM memberships WHERE user_id=?", [V]); assert.equal((await run()).tasks, 0, 'no access to the organization any more');
});
