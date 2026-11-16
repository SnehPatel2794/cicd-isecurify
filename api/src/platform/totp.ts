import crypto from 'node:crypto';
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function b32encode(buf: Buffer) { let bits = 0, v = 0, out = ''; for (const b of buf) { v = (v << 8) | b; bits += 8; while (bits >= 5) { out += A[(v >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += A[(v << (5 - bits)) & 31]; return out; }
export function b32decode(s: string) { let bits = 0, v = 0; const out: number[] = []; for (const c of s.replace(/=+$/, '').toUpperCase()) { const i = A.indexOf(c); if (i < 0) throw new Error('bad base32'); v = (v << 5) | i; bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
export function hotp(secret: Buffer, counter: number, digits = 6) {
  const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(counter)); const h = crypto.createHmac('sha1', secret).update(b).digest(); const o = h[19] & 15;
  const code = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 10 ** digits; return String(code).padStart(digits, '0');
}
export const newSecret = () => b32encode(crypto.randomBytes(20));
/** Returns the matched time-step (for replay protection) or null. Accepts +-1 step of clock drift. */
export function verifyTotp(secretB32: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null; const s = b32decode(secretB32); const step = Math.floor(now / 30000);
  for (const d of [0, -1, 1]) if (hotp(s, step + d) === code) return step + d; return null;
}
export const otpauthUri = (issuer: string, account: string, secret: string) => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
