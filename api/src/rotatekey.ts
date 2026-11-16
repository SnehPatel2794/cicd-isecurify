// Rotation of MFA_ENC_KEY: re-encrypts every stored authenticator secret under a new key, all or nothing. Run by an operator with the API stopped (scripts/rotate-mfa-key.ts).
import { q, tx, type Pool } from './db'; import { decrypt, encrypt } from './platform/crypto';
export const parseKey = (b64: string, name: string) => { const k = Buffer.from(b64 ?? '', 'base64'); if (k.length !== 32) throw new Error(`${name} must be base64 of exactly 32 bytes`); if (k.every(x => x === k[0])) throw new Error(`${name} looks like a placeholder`); return k; };
export async function rotateMfaKey(pool: Pool, oldKey: Buffer, newKey: Buffer, apply: boolean): Promise<{ secrets: number; applied: boolean }> {
  if (oldKey.equals(newKey)) throw new Error('The new key is the same as the old key');
  return tx(pool, async (c) => {
    const rows = await q(c, 'SELECT user_id, secret_enc FROM mfa_secrets FOR UPDATE'); const next: [string, string][] = [];
    for (const r of rows) { let plain: string; try { plain = decrypt(r.secret_enc, oldKey); } catch { throw new Error(`The old key cannot open the secret of user ${r.user_id}. Nothing was changed.`); }
      const enc = encrypt(plain, newKey); if (decrypt(enc, newKey) !== plain) throw new Error('Self-check failed. Nothing was changed.'); next.push([r.user_id, enc]); }
    if (apply) for (const [id, enc] of next) await c.query('UPDATE mfa_secrets SET secret_enc=? WHERE user_id=?', [enc, id]);
    return { secrets: next.length, applied: apply };
  });
}
