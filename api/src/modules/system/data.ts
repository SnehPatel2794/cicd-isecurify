// Platform-level system status queries (not tenant data). Read only.
import { q, type Conn } from '../../db';
export const recentBackups = (c: Conn) => q(c, 'SELECT id, kind, ok, taken_at takenAt, db_bytes dbBytes, evidence_bytes evidenceBytes, encrypted, note FROM backup_log ORDER BY id DESC LIMIT 30');
export const migrationInfo = async (c: Conn) => { const r = (await q(c, 'SELECT COUNT(*) n, MAX(name) latest FROM schema_migrations'))[0]; return { count: Number(r.n), latest: r.latest as string | null }; };
export const queueCounts = async (c: Conn) => { const rows = await q(c, "SELECT status, COUNT(*) n, MIN(CASE WHEN status='pending' THEN run_at END) oldest FROM jobs GROUP BY status"); const out: Record<string, number> = {}; let oldest: Date | null = null; for (const r of rows) { out[r.status] = Number(r.n); if (r.oldest) oldest = new Date(r.oldest); } return { pending: out.pending ?? 0, running: out.running ?? 0, dead: out.dead ?? 0, oldestPending: oldest }; };
export const failedEmails24h = async (c: Conn) => Number((await q(c, "SELECT COUNT(*) n FROM email_log WHERE status='failed' AND created_at > (NOW() - INTERVAL 1 DAY)"))[0].n);
export const dbNow = async (c: Conn) => new Date((await q(c, 'SELECT NOW(3) t'))[0].t);
