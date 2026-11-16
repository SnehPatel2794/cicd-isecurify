import mysql from 'mysql2/promise'; import crypto from 'node:crypto';
import { migrate } from '../../api/src/migrate'; import { makePool } from '../../api/src/db';
export const ADMIN_URL = process.env.TEST_ADMIN_URL || 'mysql://grc:grc_test_pw@127.0.0.1:3306/';
export async function freshDb() {
  const name = 'grc_w_' + crypto.randomBytes(4).toString('hex'); const a = await mysql.createConnection(ADMIN_URL); await a.query(`CREATE DATABASE ${name}`); await a.end();
  const pool: any = makePool(ADMIN_URL + name); await migrate(pool);
  return { pool, close: async () => { await pool.end(); const b = await mysql.createConnection(ADMIN_URL); await b.query(`DROP DATABASE IF EXISTS ${name}`); await b.end(); } };
}
