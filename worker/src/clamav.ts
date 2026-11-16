// Minimal clamd client (INSTREAM over TCP). The file is streamed, never loaded into memory. No dependency on any third-party package.
import net from 'node:net'; import fs from 'node:fs';
export type ScanResult = { status: 'clean' | 'infected' | 'error'; signature?: string; detail?: string };
export type ClamTarget = { host: string; port: number; timeoutMs?: number };
/** Parses clamd's reply line: "stream: OK", "stream: Eicar-Test-Signature FOUND", "INSTREAM size limit exceeded. ERROR". */
export function parseReply(raw: string): ScanResult {
  const s = raw.replace(/\0/g, '').trim();
  if (/\bERROR$/.test(s)) return { status: 'error', detail: s.slice(0, 500) };
  if (/\bFOUND$/.test(s)) { const m = /^stream:\s*(.+?)\s+FOUND$/.exec(s); return { status: 'infected', signature: (m ? m[1] : 'unknown').slice(0, 190) }; }
  if (/^stream:\s*OK$/.test(s)) return { status: 'clean' };
  return { status: 'error', detail: ('unexpected scanner reply: ' + s).slice(0, 500) };
}
/** Streams a file to clamd. Rejects on connection problems/timeouts (so the job is retried); resolves with the verdict otherwise. */
export function scanFile(target: ClamTarget, filePath: string, chunk = 64 * 1024): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(target.port, target.host); let reply = ''; let settled = false;
    const done = (fn: () => void) => { if (settled) return; settled = true; sock.destroy(); fn(); };
    sock.setTimeout(target.timeoutMs ?? 60_000, () => done(() => reject(new Error('clamd timed out'))));
    sock.on('error', e => done(() => reject(new Error('clamd connection failed: ' + e.message))));
    sock.on('data', d => { reply += d.toString('utf8'); if (reply.length > 4096) done(() => reject(new Error('clamd reply too long'))); });
    sock.on('end', () => done(() => reply ? resolve(parseReply(reply)) : reject(new Error('clamd closed the connection without a reply'))));
    sock.on('connect', () => {
      sock.write('zINSTREAM\0'); const rs = fs.createReadStream(filePath, { highWaterMark: chunk });
      rs.on('data', (b: Buffer | string) => { const buf = Buffer.isBuffer(b) ? b : Buffer.from(b); const len = Buffer.alloc(4); len.writeUInt32BE(buf.length); if (!sock.write(Buffer.concat([len, buf]))) { rs.pause(); sock.once('drain', () => rs.resume()); } });
      rs.on('end', () => sock.write(Buffer.alloc(4)));   // zero-length chunk ends the stream
      rs.on('error', e => done(() => reject(new Error('cannot read file: ' + (e as any).code || e.message))));
    });
  });
}
