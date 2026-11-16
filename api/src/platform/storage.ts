// Evidence/template file storage on a local volume. Files are WRITE-ONCE and addressed by ids the server generates (never by user-supplied names),
// so path traversal is impossible by construction. Writes go to .tmp first, are hashed on the way in, and are moved into place with an atomic rename.
import fs from 'node:fs'; import fsp from 'node:fs/promises'; import path from 'node:path'; import crypto from 'node:crypto';
import { Transform, type Readable } from 'node:stream'; import { pipeline } from 'node:stream/promises';

export class StorageError extends Error { constructor(public code: 'too_large' | 'bad_key' | 'missing', msg: string) { super(msg); } }
const KEY_RE = /^(evidence\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|templates\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
export const evidenceKey = (tenantId: string, versionId: string) => `evidence/${tenantId}/${versionId}`;
export const templateKey = (id: string) => `templates/${id}`;
export type Received = { tmp: string; size: number; sha256: string; head: Buffer };

export class LocalStorage {
  readonly root: string;
  constructor(root: string) { this.root = path.resolve(root); }
  async init() { await fsp.mkdir(path.join(this.root, '.tmp'), { recursive: true, mode: 0o700 }); }
  /** Absolute path for a key; throws unless the key has exactly the shape this module generates. */
  pathOf(key: string) { if (!KEY_RE.test(key)) throw new StorageError('bad_key', 'invalid storage key'); const p = path.resolve(this.root, key); if (!p.startsWith(this.root + path.sep)) throw new StorageError('bad_key', 'invalid storage key'); return p; }
  /** Streams `src` into a temp file, computing size and SHA-256 and keeping the first 8 KB for content checks. Aborts (and removes the temp file) beyond `maxBytes`. */
  async receive(src: Readable, maxBytes: number): Promise<Received> {
    await this.init(); const tmp = path.join(this.root, '.tmp', crypto.randomUUID()); const h = crypto.createHash('sha256'); let size = 0; const heads: Buffer[] = []; let headLen = 0;
    const meter = new Transform({ transform(chunk: Buffer, _e, cb) { size += chunk.length; if (size > maxBytes) return cb(new StorageError('too_large', 'file too large')); h.update(chunk); if (headLen < 8192) { heads.push(chunk.subarray(0, 8192 - headLen)); headLen += Math.min(chunk.length, 8192 - headLen); } cb(null, chunk); } });
    try { await pipeline(src, meter, fs.createWriteStream(tmp, { flags: 'wx', mode: 0o600 })); }
    catch (e) { await fsp.rm(tmp, { force: true }); throw e; }
    return { tmp, size, sha256: h.digest('hex'), head: Buffer.concat(heads) };
  }
  /** Atomic move of a received temp file to its final key. Refuses to overwrite: stored files are immutable. */
  async commit(tmp: string, key: string) { const dest = this.pathOf(key); await fsp.mkdir(path.dirname(dest), { recursive: true, mode: 0o700 }); await fsp.link(tmp, dest); await fsp.rm(tmp, { force: true }); await fsp.chmod(dest, 0o440).catch(() => {}); }
  async discard(tmp: string) { await fsp.rm(tmp, { force: true }); }
  async remove(key: string) { await fsp.rm(this.pathOf(key), { force: true }); }
  open(key: string): fs.ReadStream { return fs.createReadStream(this.pathOf(key)); }
  /** Free and total bytes of the disk holding the evidence directory, or null when the platform cannot tell. */
  async diskSpace(): Promise<{ freeBytes: number; totalBytes: number } | null> { try { await this.init(); const f = await fsp.statfs(this.root); return { freeBytes: Number(f.bavail) * Number(f.bsize), totalBytes: Number(f.blocks) * Number(f.bsize) }; } catch { return null; } }
  async exists(key: string) { try { await fsp.access(this.pathOf(key)); return true; } catch { return false; } }
  /** Re-reads the stored bytes and returns their size and SHA-256 (integrity verification). */
  async hashOf(key: string): Promise<{ size: number; sha256: string }> {
    const p = this.pathOf(key); const h = crypto.createHash('sha256'); let size = 0;
    try { await pipeline(fs.createReadStream(p), new Transform({ transform(c: Buffer, _e, cb) { size += c.length; h.update(c); cb(); } })); }
    catch (e: any) { if (e.code === 'ENOENT') throw new StorageError('missing', 'file is missing from storage'); throw e; }
    return { size, sha256: h.digest('hex') };
  }
}
