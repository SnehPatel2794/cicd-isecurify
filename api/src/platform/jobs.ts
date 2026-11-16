import type { Conn } from '../db';
export async function enqueue(c: Conn, j: { type: string; payload?: unknown; idempotencyKey?: string; runAt?: Date; maxAttempts?: number }) {
  await c.query('INSERT INTO jobs(type,payload,idempotency_key,run_at,max_attempts) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id',
    [j.type, j.payload ? JSON.stringify(j.payload) : null, j.idempotencyKey ?? null, j.runAt ?? new Date(), j.maxAttempts ?? 5]);
}
