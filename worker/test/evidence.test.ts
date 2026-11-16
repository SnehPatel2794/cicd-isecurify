import { test, before, after } from 'node:test'; import assert from 'node:assert/strict'; import net from 'node:net'; import fsp from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
import { freshDb } from './helpers'; import { enqueue, runOnce } from '../src/queue'; import { makeScanHandler, sweepOrphans } from '../src/evidence'; import { parseReply, scanFile } from '../src/clamav';
let db: Awaited<ReturnType<typeof freshDb>>; const pool = () => db.pool; let dir: string; const T = crypto.randomUUID(); const U = crypto.randomUUID();
const uid = () => crypto.randomUUID(); const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const key = (v: string) => `evidence/${T}/${v}`;

/** A fake clamd: speaks INSTREAM, reassembles the stream, and answers per `behaviour(data)`. */
function fakeClamd(behaviour: (data: Buffer) => string | 'hang' | 'drop') {
  const received: Buffer[] = [];
  const srv = net.createServer(sock => {
    let buf = Buffer.alloc(0); let started = false; const chunks: Buffer[] = [];
    sock.on('error', () => {});
    sock.on('data', (d: any) => { buf = Buffer.concat([buf, Buffer.from(d)]);
      if (!started) { const i = buf.indexOf(0); if (i < 0) return; assert.equal(buf.subarray(0, i).toString(), 'zINSTREAM'); buf = buf.subarray(i + 1); started = true; }
      while (buf.length >= 4) { const n = buf.readUInt32BE(0); if (n === 0) { const data = Buffer.concat(chunks); received.push(data); const r = behaviour(data); if (r === 'drop') return sock.destroy(); if (r !== 'hang') sock.end(r + '\0'); return; } if (buf.length < 4 + n) return; chunks.push(buf.subarray(4, 4 + n)); buf = buf.subarray(4 + n); }
    });
  });
  return new Promise<{ port: number; received: Buffer[]; close: () => Promise<void> }>(res => srv.listen(0, '127.0.0.1', () => res({ port: (srv.address() as any).port, received, close: () => new Promise<void>(r => srv.close(() => r())) })));
}
// A version row + the file on disk. FK checks are off on this one connection only: the worker tests need the version rows, not the whole tenant graph.
async function addVersion(content: Buffer | null, over: { sha?: string; kind?: 'file' | 'link' } = {}) {
  const c = await pool().getConnection(); const vid = uid();
  try { await c.query('SET FOREIGN_KEY_CHECKS=0'); const k = key(vid);
    if (over.kind === 'link') await c.query("INSERT INTO evidence_versions(tenant_id,id,request_id,version_no,kind,link_url,uploaded_by) VALUES (?,?,?,?,?,?,?)", [T, vid, uid(), 1, 'link', 'https://x.example.com/a', U]);
    else { await c.query("INSERT INTO evidence_versions(tenant_id,id,request_id,version_no,kind,file_name,media_type,size_bytes,sha256,storage_key,uploaded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [T, vid, uid(), 1, 'file', 'a.txt', 'text/plain', 5, over.sha ?? sha(content ?? Buffer.from('x')), k, U]);
      if (content) { await fsp.mkdir(path.join(dir, 'evidence', T), { recursive: true }); await fsp.writeFile(path.join(dir, k), content); } }
  } finally { await c.query('SET FOREIGN_KEY_CHECKS=1').catch(() => {}); c.release(); }
  return vid;
}
const scans = async (vid: string) => ((await pool().query('SELECT status,signature,detail,requested_by FROM evidence_scans WHERE version_id=? ORDER BY scanned_at', [vid]))[0] as any[]);
const job = async (vid: string, maxAttempts = 3, requestedBy: string | null = null) => { await pool().query('DELETE FROM jobs'); await enqueue(pool(), { type: 'evidence.scan', payload: { tenantId: T, versionId: vid, requestedBy }, maxAttempts }); };
const jobRow = async () => ((await pool().query('SELECT status,attempts,last_error FROM jobs ORDER BY id DESC LIMIT 1'))[0] as any[])[0];
const handlers = (port: number | null) => ({ 'evidence.scan': makeScanHandler(() => ({ dir, clam: port ? { host: '127.0.0.1', port, timeoutMs: 1500 } : null })) });
const retryNow = () => pool().query("UPDATE jobs SET run_at=NOW(3) - INTERVAL 1 SECOND WHERE status='pending'");

before(async () => { db = await freshDb(); dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ev-')); await pool().query("INSERT INTO users(id,email,name) VALUES (?,?,?)", [U, 'w@x.test', 'Worker Test']); });
after(async () => { await db.close(); await fsp.rm(dir, { recursive: true, force: true }); });

test('parseReply understands clamd answers', () => {
  assert.deepEqual(parseReply('stream: OK\0'), { status: 'clean' });
  assert.deepEqual(parseReply('stream: Eicar-Test-Signature FOUND\0'), { status: 'infected', signature: 'Eicar-Test-Signature' });
  assert.equal(parseReply('INSTREAM size limit exceeded. ERROR').status, 'error'); assert.equal(parseReply('garbage').status, 'error'); assert.equal(parseReply('').status, 'error');
});
test('clean file: streamed byte-exact to clamd and recorded as clean (with who asked)', async () => {
  const body = crypto.randomBytes(300_000); const clam = await fakeClamd(() => 'stream: OK'); const vid = await addVersion(body); await job(vid, 3, U);
  assert.equal(await runOnce(pool(), handlers(clam.port)), true); { const jr = await jobRow(); assert.equal(jr.status, 'done', JSON.stringify(jr)); } assert.equal(clam.received.length, 1); assert.ok(clam.received[0].equals(body));   // spans several 64 KB chunks
  const s = await scans(vid); assert.equal(s.length, 1); assert.equal(s[0].status, 'clean'); assert.equal(s[0].requested_by, U); await clam.close();
});
test('infected file: signature recorded', async () => {
  const clam = await fakeClamd(() => 'stream: Win.Test.EICAR_HDB-1 FOUND'); const vid = await addVersion(Buffer.from('X5O!P%@AP')); await job(vid); await runOnce(pool(), handlers(clam.port));
  const s = await scans(vid); assert.equal(s.length, 1); assert.equal(s[0].status, 'infected'); assert.equal(s[0].signature, 'Win.Test.EICAR_HDB-1'); assert.equal((await jobRow()).status, 'done'); await clam.close();
});
test('tampered file: integrity failure is recorded at once, never sent to the scanner, never retried', async () => {
  const clam = await fakeClamd(() => 'stream: OK'); const vid = await addVersion(Buffer.from('changed on disk'), { sha: sha(Buffer.from('original')) }); await job(vid); await runOnce(pool(), handlers(clam.port));
  const s = await scans(vid); assert.equal(s.length, 1); assert.equal(s[0].status, 'error'); assert.match(s[0].detail, /integrity/); assert.equal(clam.received.length, 0); assert.equal((await jobRow()).status, 'done'); await clam.close();
});
test('missing file: error row, no retry loop', async () => {
  const vid = await addVersion(null); await job(vid); await runOnce(pool(), handlers(1)); const s = await scans(vid); assert.equal(s.length, 1); assert.match(s[0].detail, /missing/);
});
test('scanner down: retried with backoff, error row ONLY after the last attempt', async () => {
  const closed = await fakeClamd(() => 'x'); const port = closed.port; await closed.close();   // a port nobody listens on
  const vid = await addVersion(Buffer.from('hello')); await job(vid, 3); const h = handlers(port);
  await runOnce(pool(), h); assert.equal((await jobRow()).status, 'pending'); assert.equal((await scans(vid)).length, 0); await retryNow();
  await runOnce(pool(), h); assert.equal((await scans(vid)).length, 0); await retryNow();
  await runOnce(pool(), h); const r = await jobRow(); assert.equal(r.status, 'done'); const s = await scans(vid); assert.equal(s.length, 1); assert.equal(s[0].status, 'error'); assert.match(s[0].detail, /connection failed/);
});
test('scanner hangs: times out instead of blocking the worker', async () => {
  const clam = await fakeClamd(() => 'hang'); const vid = await addVersion(Buffer.from('slow')); const t0 = Date.now(); await job(vid, 1); await runOnce(pool(), handlers(clam.port));
  assert.ok(Date.now() - t0 < 5000); assert.match((await scans(vid))[0].detail, /timed out/); await clam.close();
});
test('scanner drops the connection / reports a size-limit error', async () => {
  let clam = await fakeClamd(() => 'drop'); let vid = await addVersion(Buffer.from('a')); await job(vid, 1); await runOnce(pool(), handlers(clam.port)); assert.equal((await scans(vid))[0].status, 'error'); await clam.close();
  clam = await fakeClamd(() => 'INSTREAM size limit exceeded. ERROR'); vid = await addVersion(Buffer.from('b')); await job(vid, 1); await runOnce(pool(), handlers(clam.port)); assert.match((await scans(vid))[0].detail, /size limit/); await clam.close();
});
test('scanner not configured: error row after the last attempt; links and unknown ids are skipped quietly', async () => {
  const vid = await addVersion(Buffer.from('c')); await job(vid, 1); await runOnce(pool(), handlers(null)); assert.match((await scans(vid))[0].detail, /not configured/);
  const lv = await addVersion(null, { kind: 'link' }); await job(lv); await runOnce(pool(), handlers(null)); assert.equal((await jobRow()).status, 'done'); assert.equal((await scans(lv)).length, 0);
  await job(uid()); await runOnce(pool(), handlers(null)); assert.equal((await jobRow()).status, 'done');
});
test('a malicious storage key in the DB cannot make the worker read outside the volume', async () => {
  const vid = uid(); const c = await pool().getConnection(); try { await c.query('SET FOREIGN_KEY_CHECKS=0'); await c.query("INSERT INTO evidence_versions(tenant_id,id,request_id,version_no,kind,file_name,size_bytes,sha256,storage_key,uploaded_by) VALUES (?,?,?,?,?,?,?,?,?,?)", [T, vid, uid(), 1, 'file', 'a', 1, 'a'.repeat(64), '../../etc/passwd', U]); } finally { await c.query('SET FOREIGN_KEY_CHECKS=1'); c.release(); }
  await job(vid, 1); await runOnce(pool(), handlers(1)); assert.equal((await jobRow()).status, 'dead'); assert.match((await jobRow()).last_error, /invalid storage key/);
});
test('scan rows are append-only for everybody', async () => {
  const vid = await addVersion(Buffer.from('d')); await pool().query("INSERT INTO evidence_scans(tenant_id,id,version_id,status) VALUES (?,?,?,'clean')", [T, uid(), vid]).catch(() => {});
  await assert.rejects(() => pool().query("UPDATE evidence_scans SET status='clean'")); await assert.rejects(() => pool().query('DELETE FROM evidence_scans'));
});

test('orphan sweep: removes old unreferenced files and stale temp files; keeps referenced and recent ones; reports missing', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sw-')); const p = pool(); const keep = uid(), orphan = uid(), fresh = uid(), gone = uid(); const tpl = uid(), tplOrphan = uid();
  const put = async (k: string, ageH: number) => { const f = path.join(root, k); await fsp.mkdir(path.dirname(f), { recursive: true }); await fsp.writeFile(f, 'x'); const t = new Date(Date.now() - ageH * 3600_000); await fsp.utimes(f, t, t); };
  const c = await p.getConnection(); try { await c.query('SET FOREIGN_KEY_CHECKS=0');
    for (const v of [keep, gone]) await c.query("INSERT INTO evidence_versions(tenant_id,id,request_id,version_no,kind,file_name,size_bytes,sha256,storage_key,uploaded_by) VALUES (?,?,?,?,?,?,?,?,?,?)", [T, v, uid(), 1, 'file', 'a', 1, 'a'.repeat(64), key(v), U]);
    await c.query("INSERT INTO evidence_templates(id,name,file_name,media_type,size_bytes,sha256,storage_key,created_by) VALUES (?,?,?,?,?,?,?,?)", [tpl, 't', 'a.pdf', 'application/pdf', 1, 'b'.repeat(64), `templates/${tpl}`, U]);
  } finally { await c.query('SET FOREIGN_KEY_CHECKS=1'); c.release(); }
  await put(key(keep), 100); await put(key(orphan), 100); await put(key(fresh), 1); await put(`templates/${tpl}`, 100); await put(`templates/${tplOrphan}`, 100); await put('.tmp/old', 100); await put('.tmp/new', 1);
  await put(`evidence/${T}/not-a-uuid`, 100);   // foreign-looking files are never touched
  const r = await sweepOrphans(p, root); assert.deepEqual(r.removed.sort(), [key(orphan), `templates/${tplOrphan}`].sort()); assert.equal(r.tmpRemoved, 1); assert.ok(r.missing.includes(key(gone))); assert.ok(!r.missing.includes(key(keep)));   // other tests' rows share this DB, so only our own keys are asserted
  const ex = async (k: string) => fsp.access(path.join(root, k)).then(() => true, () => false);
  assert.equal(await ex(key(keep)), true); assert.equal(await ex(key(fresh)), true); assert.equal(await ex(`templates/${tpl}`), true); assert.equal(await ex(`evidence/${T}/not-a-uuid`), true); assert.equal(await ex('.tmp/new'), true); assert.equal(await ex(key(orphan)), false); assert.equal(await ex('.tmp/old'), false);
  await fsp.rm(root, { recursive: true, force: true });
});
test('orphan sweep on a missing volume does not throw', async () => { const r = await sweepOrphans(pool(), '/nonexistent/evidence-root'); assert.equal(r.removed.length, 0); });
