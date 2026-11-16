// One-shot, run by ROOT only once per deploy: creates/refreshes the least-privilege migrator account. Everything after this runs as that account.
import { makePool } from './db'; import { applyMigratorGrants } from './grants';
const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is required`); return v; };
const pool = makePool(need('ROOT_DATABASE_URL')); const db = process.env.DB_NAME || 'grc';
await applyMigratorGrants(pool, db, need('MIGRATOR_DB_USER'), need('MIGRATOR_DB_PASSWORD')); console.log('migrator account ready'); await pool.end();
