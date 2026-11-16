import mysql from 'mysql2/promise';
export type Pool = mysql.Pool; export type Conn = mysql.Pool | mysql.PoolConnection;
export const makePool = (url: string): Pool => mysql.createPool({ uri: url, connectionLimit: 10, timezone: 'Z', charset: 'utf8mb4' });
export const q = async (c: Conn, sql: string, p: any[] = []): Promise<any[]> => (await c.query(sql, p))[0] as any[];
export async function tx<T>(pool: Pool, fn: (c: mysql.PoolConnection) => Promise<T>): Promise<T> {
  const c = await pool.getConnection();
  try { await c.beginTransaction(); const r = await fn(c); await c.commit(); return r; }
  catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}
