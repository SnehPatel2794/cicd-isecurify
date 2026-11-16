// Creates a brand-new database, applies every migration and the least-privilege grants, and leaves the API to connect as a limited account (never root).
// Lives in api/scripts so its dependencies resolve. Run from the api folder:  npx tsx scripts/e2e-prepare.ts
import mysql from 'mysql2/promise'; import fs from 'node:fs'; import path from 'node:path';
import { ADMIN_URL, DB_NAME, APP_USER, APP_PW, WORKER_USER, WORKER_PW } from '../../e2e/env';
import { makePool } from '../src/db'; import { migrate } from '../src/migrate'; import { applyGrants } from '../src/grants';
const admin = await mysql.createConnection(ADMIN_URL);
await admin.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``); await admin.query(`CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4`); await admin.end();
const pool = makePool(ADMIN_URL.replace(/\/?$/, '/') + DB_NAME);
const applied = await migrate(pool); await applyGrants(pool, DB_NAME, APP_USER, APP_PW, WORKER_USER, WORKER_PW); await pool.end();
const run = path.resolve(process.cwd(), '../e2e/.run'); fs.rmSync(run, { recursive: true, force: true }); fs.mkdirSync(path.join(run, 'evidence'), { recursive: true });
console.log(`e2e database ready: ${applied.length} migrations, accounts ${APP_USER}/${WORKER_USER}`);
