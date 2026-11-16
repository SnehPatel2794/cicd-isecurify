// One-shot: runs migrations and (re)applies least-privilege grants. Uses an admin/root URL; runs in the "init" container only.
import { makePool } from './db'; import { migrate } from './migrate'; import { applyGrants } from './grants';
const url = process.env.ADMIN_DATABASE_URL!; const db = process.env.DB_NAME || 'grc';
const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is required`); return v; };
const pool = makePool(url);
console.log('migrations applied:', await migrate(pool));
await applyGrants(pool, db, need('APP_DB_USER'), need('APP_DB_PASSWORD'), need('WORKER_DB_USER'), need('WORKER_DB_PASSWORD'), '%', process.env.PURGE_DB_PASSWORD ? { user: process.env.PURGE_DB_USER || 'grc_purge', pw: process.env.PURGE_DB_PASSWORD } : undefined);
console.log('grants applied'); await pool.end();
