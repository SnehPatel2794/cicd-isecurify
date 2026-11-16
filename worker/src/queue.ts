import mysql from 'mysql2/promise';
export type Pool = mysql.Pool;
export type Job = { id: number; type: string; payload: any; attempts: number; max_attempts: number };
export type Handler = (job: Job, ctx: { pool: Pool }) => Promise<void>;

export async function enqueue(pool: Pool, j: { type: string; payload?: unknown; idempotencyKey?: string; runAt?: Date; maxAttempts?: number }) {
  await pool.query('INSERT INTO jobs(type,payload,idempotency_key,run_at,max_attempts) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id',
    [j.type, j.payload ? JSON.stringify(j.payload) : null, j.idempotencyKey ?? null, j.runAt ?? new Date(), j.maxAttempts ?? 5]);
}
/** Atomically claims one due job. SKIP LOCKED lets several workers run without ever taking the same job. */
export async function claim(pool: Pool): Promise<Job | null> {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [rows] = await c.query("SELECT id,type,payload,attempts,max_attempts FROM jobs WHERE status='pending' AND run_at<=NOW(3) ORDER BY run_at,id LIMIT 1 FOR UPDATE SKIP LOCKED") as any;
    if (!rows.length) { await c.commit(); return null; }
    const j = rows[0]; await c.query("UPDATE jobs SET status='running', locked_at=NOW(3), attempts=attempts+1 WHERE id=?", [j.id]); await c.commit();
    return { ...j, attempts: j.attempts + 1, payload: typeof j.payload === 'string' ? JSON.parse(j.payload) : j.payload };
  } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}
export const backoffSeconds = (attempt: number) => Math.min(3600, 2 ** attempt * 10);
export async function complete(pool: Pool, id: number, clearPayload = false) {
  await pool.query(`UPDATE jobs SET status='done', finished_at=NOW(3), locked_at=NULL, last_error=NULL${clearPayload ? ', payload=NULL' : ''} WHERE id=?`, [id]);
}
export async function fail(pool: Pool, job: Job, err: unknown) {
  const msg = String((err as any)?.message ?? err).slice(0, 1000);
  if (job.attempts >= job.max_attempts) await pool.query("UPDATE jobs SET status='dead', finished_at=NOW(3), locked_at=NULL, last_error=?, payload=NULL WHERE id=?", [msg, job.id]);
  else await pool.query("UPDATE jobs SET status='pending', locked_at=NULL, last_error=?, run_at=DATE_ADD(NOW(3), INTERVAL ? SECOND) WHERE id=?", [msg, backoffSeconds(job.attempts), job.id]);
}
/** Jobs whose worker crashed stay 'running'. Put them back (attempts already counted, so poison jobs still end up dead). */
export async function reapStale(pool: Pool, minutes = 10) {
  const [r]: any = await pool.query("UPDATE jobs SET status=IF(attempts>=max_attempts,'dead','pending'), locked_at=NULL, last_error='worker crashed or timed out' WHERE status='running' AND locked_at < DATE_SUB(NOW(3), INTERVAL ? MINUTE)", [minutes]);
  return r.affectedRows as number;
}
export async function runOnce(pool: Pool, handlers: Record<string, Handler>): Promise<boolean> {
  const job = await claim(pool); if (!job) return false;
  try {
    const h = handlers[job.type]; if (!h) throw new Error(`no handler for ${job.type}`);
    await h(job, { pool }); await complete(pool, job.id, job.type.startsWith('email.'));   // never keep one-time secrets after delivery
  } catch (e) { await fail(pool, job, e); }
  return true;
}
