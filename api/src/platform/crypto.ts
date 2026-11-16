import crypto from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
export const uuid = () => crypto.randomUUID();
export const sha256 = (v: string | Buffer) => crypto.createHash('sha256').update(v).digest('hex');
export const newToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const hashPassword = (pw: string) => hash(pw, { memoryCost: 19456, timeCost: 2, parallelism: 1 }); // argon2id by default
export const verifyPassword = (h: string, pw: string) => verify(h, pw).catch(() => false);
export const passwordOk = (pw: unknown): pw is string => typeof pw === 'string' && pw.length >= 12 && pw.length <= 200 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw);
export function safeEqual(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); }
export function encrypt(plain: string, key: Buffer) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'); }
export function decrypt(blob: string, key: Buffer) { const b = Buffer.from(blob, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); }
export const csrfFor = (sessionToken: string, key: string) => crypto.createHmac('sha256', key).update(sessionToken).digest('base64url');
