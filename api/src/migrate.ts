import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import type { Pool } from './db';
const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR || path.resolve(here, '../../migrations');
// Plain SQL migrations. MySQL DDL is not transactional: keep each migration small and forward-only; take a backup before running.
export async function migrate(pool: Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(100) PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
  const done = new Set(((await pool.query('SELECT name FROM schema_migrations'))[0] as any[]).map(r => r.name));
  const applied: string[] = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const stmts = fs.readFileSync(path.join(dir, f), 'utf8').split(/^-- \/\/\s*$/m).map(s => s.trim()).filter(Boolean);
    for (const s of stmts) await pool.query(s);
    await pool.query('INSERT INTO schema_migrations(name) VALUES (?)', [f]); applied.push(f);
  }
  return applied;
}
