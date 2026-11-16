// Restore verification: proves a restored database (and evidence folder) is complete and consistent. Used by deploy/restore-drill.sh and after a real restore.
// Everything is derived from the migration files, so a new table or trigger is covered automatically. Read-only.
import fs from 'node:fs'; import path from 'node:path'; import { q, type Conn } from './db'; import { LocalStorage, StorageError } from './platform/storage';
export type Check = { name: string; ok: boolean; detail: string };
const strip = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
/** Tables and triggers the migrations leave behind (created minus dropped), and the migration file names. PURE given the directory. */
export function expectedFromMigrations(dir: string) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort(); const tables = new Set<string>(), triggers = new Set<string>();
  for (const f of files) { const sql = strip(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?/gi)) tables.add(m[1].toLowerCase()); for (const m of sql.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?`?(\w+)`?/gi)) tables.delete(m[1].toLowerCase());
    for (const m of sql.matchAll(/CREATE\s+TRIGGER\s+`?(\w+)`?/gi)) triggers.add(m[1].toLowerCase()); for (const m of sql.matchAll(/DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?`?(\w+)`?/gi)) triggers.delete(m[1].toLowerCase()); }
  return { files, tables: [...tables].sort(), triggers: [...triggers].sort() };
}
export const diff = (want: string[], have: string[]) => { const h = new Set(have); return want.filter(x => !h.has(x)); };
/** Compare stored files with their recorded size and SHA-256. Pure given the storage. */
export async function verifyFiles(rows: { id: string; storageKey: string; sha256: string; sizeBytes: number }[], storage: Pick<LocalStorage, 'hashOf'>): Promise<{ checked: number; missing: string[]; mismatched: string[] }> {
  const missing: string[] = [], mismatched: string[] = [];
  for (const r of rows) { try { const h = await storage.hashOf(r.storageKey); if (h.sha256 !== r.sha256 || h.size !== Number(r.sizeBytes)) mismatched.push(r.id); } catch (e) { if (e instanceof StorageError && e.code === 'missing') missing.push(r.id); else mismatched.push(r.id); } }
  return { checked: rows.length, missing, mismatched };
}
const COUNT_TABLES = ['users', 'organizations', 'memberships', 'engagements', 'findings', 'evidence_versions', 'risks', 'incidents', 'policies', 'audit_events'];
export async function runRestoreChecks(c: Conn, o: { migrationsDir: string; evidenceDir?: string; sampleFiles?: number }): Promise<{ ok: boolean; checks: Check[]; counts: Record<string, number> }> {
  const checks: Check[] = []; const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail }); const want = expectedFromMigrations(o.migrationsDir);
  const db = (await q(c, 'SELECT DATABASE() d'))[0].d as string;
  const applied = (await q(c, 'SELECT name FROM schema_migrations')).map((r: any) => r.name as string); const missingMig = diff(want.files, applied), extraMig = diff(applied, want.files);
  add('migrations', !missingMig.length && !extraMig.length, !missingMig.length && !extraMig.length ? `${applied.length} migrations recorded` : `missing ${missingMig.join(', ') || 'none'}; unknown ${extraMig.join(', ') || 'none'}`);
  const tables = (await q(c, 'SELECT LOWER(table_name) t FROM information_schema.tables WHERE table_schema=?', [db])).map((r: any) => r.t as string); const missingTables = diff(want.tables, tables);
  add('tables', !missingTables.length, missingTables.length ? `missing: ${missingTables.join(', ')}` : `${want.tables.length} tables present`);
  const triggers = (await q(c, 'SELECT LOWER(trigger_name) t FROM information_schema.triggers WHERE trigger_schema=?', [db])).map((r: any) => r.t as string); const missingTriggers = diff(want.triggers, triggers);
  add('triggers', !missingTriggers.length, missingTriggers.length ? `missing (append-only and immutability protections!): ${missingTriggers.join(', ')}` : `${want.triggers.length} protective triggers present`);
  // Every foreign key: no child row may point at a parent that does not exist (a restore with checks switched off can hide this).
  const fk = await q(c, `SELECT k.constraint_name cn, k.table_name child, k.column_name col, k.referenced_table_name parent, k.referenced_column_name pcol, k.ordinal_position pos FROM information_schema.key_column_usage k WHERE k.table_schema=? AND k.referenced_table_name IS NOT NULL ORDER BY k.table_name, k.constraint_name, k.ordinal_position`, [db]);
  const groups = new Map<string, any[]>(); for (const r of fk) { const key = `${r.child}.${r.cn}`; (groups.get(key) ?? groups.set(key, []).get(key)!).push(r); } const orphans: string[] = [];
  for (const [key, cols] of groups) { const child = cols[0].child, parent = cols[0].parent; const on = cols.map((x: any) => `c.\`${x.col}\`=p.\`${x.pcol}\``).join(' AND '), nn = cols.map((x: any) => `c.\`${x.col}\` IS NOT NULL`).join(' AND ');
    const bad = await q(c, `SELECT 1 x FROM \`${child}\` c LEFT JOIN \`${parent}\` p ON ${on} WHERE p.\`${cols[0].pcol}\` IS NULL AND ${nn} LIMIT 1`); if (bad.length) orphans.push(key); }
  add('foreign keys', !orphans.length, orphans.length ? `rows without a parent in: ${orphans.join(', ')}` : `${groups.size} relationships consistent`);
  const admins = Number((await q(c, "SELECT COUNT(*) n FROM users WHERE platform_role='super_admin' AND status='active'"))[0].n); add('administrator', admins >= 1, admins >= 1 ? `${admins} active super admin(s)` : 'no active super admin: nobody could sign in to administer the system');
  if (o.evidenceDir) { const limit = Math.max(1, Math.min(o.sampleFiles ?? 200, 5000)); const rows = (await q(c, "SELECT id, storage_key storageKey, sha256, size_bytes sizeBytes FROM evidence_versions WHERE kind='file' ORDER BY RAND() LIMIT ?", [limit])) as any[];
    const total = Number((await q(c, "SELECT COUNT(*) n FROM evidence_versions WHERE kind='file'"))[0].n); const r = await verifyFiles(rows, new LocalStorage(o.evidenceDir)); const bad = r.missing.length + r.mismatched.length;
    add('evidence files', bad === 0, bad ? `${r.missing.length} missing and ${r.mismatched.length} changed out of ${r.checked} checked (versions: ${[...r.missing, ...r.mismatched].slice(0, 5).join(', ')})` : `${r.checked} of ${total} file(s) checked, size and SHA-256 match`);
  } else add('evidence files', true, 'not checked (no evidence folder given)');
  const counts: Record<string, number> = {}; for (const t of COUNT_TABLES) if (tables.includes(t)) counts[t] = Number((await q(c, `SELECT COUNT(*) n FROM \`${t}\``))[0].n);
  return { ok: checks.every(x => x.ok), checks, counts };
}
