// evidence.scan job + orphan-file sweep. The worker only READS evidence files and versions; its one write is an append-only scan row.
import fs from 'node:fs'; import fsp from 'node:fs/promises'; import path from 'node:path'; import crypto from 'node:crypto';
import type { Handler, Pool } from './queue'; import { scanFile, type ClamTarget, type ScanResult } from './clamav';
export type EvidenceEnv = { dir: string; clam: ClamTarget | null };
export const evidenceEnv = (): EvidenceEnv => {
  const h = process.env.CLAMAV_HOST; let clam: ClamTarget | null = null;
  if (h) { const [host, port] = h.split(':'); clam = { host, port: Number(port || 3310) }; }
  return { dir: process.env.EVIDENCE_DIR || '/data/evidence', clam };
};
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY_RE = new RegExp(`^(evidence/${UUID}/${UUID}|templates/${UUID})$`);
const sha256Of = (p: string) => new Promise<string>((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(p).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
async function addScan(pool: Pool, tenantId: string, versionId: string, r: ScanResult, requestedBy: string | null, engine = 'clamav') {
  await pool.query('INSERT INTO evidence_scans(tenant_id,id,version_id,status,signature,engine,detail,requested_by) VALUES (?,?,?,?,?,?,?,?)',
    [tenantId, crypto.randomUUID(), versionId, r.status, r.signature ?? null, engine, r.detail ?? null, requestedBy]);
}
/** Scans one stored version. Integrity first (the bytes must still match the recorded SHA-256), then clamd.
 *  Connection problems throw so the queue retries; on the LAST attempt an 'error' row is written so the UI shows a result instead of silence. */
export const makeScanHandler = (env: () => EvidenceEnv): Handler => async (job, { pool }) => {
  const { tenantId, versionId, requestedBy } = job.payload ?? {}; const e = env();
  if (!tenantId || !versionId) throw new Error('bad payload');
  const [rows] = await pool.query("SELECT kind, sha256, storage_key FROM evidence_versions WHERE tenant_id=? AND id=?", [tenantId, versionId]) as any;
  if (!rows.length || rows[0].kind !== 'file') return;   // nothing to scan (links, or an unknown id): finish quietly
  const { sha256, storage_key } = rows[0];
  if (!KEY_RE.test(storage_key)) throw new Error('invalid storage key');
  const fail = async (msg: string, retry: boolean) => { if (retry && job.attempts < job.max_attempts) throw new Error(msg); await addScan(pool, tenantId, versionId, { status: 'error', detail: msg }, requestedBy ?? null); };
  if (!e.clam) return fail('malware scanner is not configured (CLAMAV_HOST)', true);
  const file = path.join(path.resolve(e.dir), storage_key);
  let actual: string; try { actual = await sha256Of(file); } catch (err: any) { return fail(err.code === 'ENOENT' ? 'file is missing from storage' : 'cannot read file: ' + err.code, false); }
  if (actual !== sha256) return fail('integrity check failed: stored bytes no longer match the recorded SHA-256', false);   // permanent, never retried
  let res: ScanResult; try { res = await scanFile(e.clam, file); } catch (err: any) { return fail(String(err.message), true); }
  if (res.status === 'error' && job.attempts < job.max_attempts) throw new Error(res.detail || 'scanner error');
  await addScan(pool, tenantId, versionId, res, requestedBy ?? null);
  if (res.status === 'infected') await pool.query('INSERT INTO outbox_events(tenant_id,type,payload,dedupe_key) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE id=id', [tenantId, 'evidence.malware_found', JSON.stringify({ tenantId, versionId }), `malware:${versionId}`]);   // people are told by the dispatcher
};

export type SweepResult = { removed: string[]; tmpRemoved: number; missing: string[] };
/** Removes files on the evidence volume that no database row refers to (failed uploads, rolled-back transactions) and stale temp files.
 *  A grace period protects files whose transaction is still in flight. Files that the DB refers to but are gone are REPORTED, never "fixed". */
export async function sweepOrphans(pool: Pool, root: string, graceMs = 24 * 3600_000, now = Date.now()): Promise<SweepResult> {
  const out: SweepResult = { removed: [], tmpRemoved: 0, missing: [] }; root = path.resolve(root);
  const old = async (p: string) => { try { return now - (await fsp.stat(p)).mtimeMs > graceMs; } catch { return false; } };
  const ls = async (p: string) => { try { return await fsp.readdir(p, { withFileTypes: true }); } catch { return []; } };
  for (const f of await ls(path.join(root, '.tmp'))) { const p = path.join(root, '.tmp', f.name); if (f.isFile() && await old(p)) { await fsp.rm(p, { force: true }); out.tmpRemoved++; } }
  const [vr] = await pool.query("SELECT storage_key FROM evidence_versions WHERE kind='file'") as any; const [tr] = await pool.query('SELECT storage_key FROM evidence_templates') as any;
  const known = new Set<string>([...vr, ...tr].map((r: any) => r.storage_key));
  for (const t of await ls(path.join(root, 'evidence'))) { if (!t.isDirectory()) continue;
    for (const f of await ls(path.join(root, 'evidence', t.name))) { const key = `evidence/${t.name}/${f.name}`; const p = path.join(root, key); if (f.isFile() && KEY_RE.test(key) && !known.has(key) && await old(p)) { await fsp.rm(p, { force: true }); out.removed.push(key); } } }
  for (const f of await ls(path.join(root, 'templates'))) { const key = `templates/${f.name}`; const p = path.join(root, key); if (f.isFile() && KEY_RE.test(key) && !known.has(key) && await old(p)) { await fsp.rm(p, { force: true }); out.removed.push(key); } }
  for (const k of known) { try { await fsp.access(path.join(root, k)); } catch { out.missing.push(k); } }
  return out;
}
