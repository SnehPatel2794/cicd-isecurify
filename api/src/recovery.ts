// Locked-out administrator recovery. Run ONLY by someone with shell access to the server (scripts/recover-admin.ts), never exposed over HTTP.
// It does not set a password: it unlocks the account, ends its sessions, optionally removes lost two-step verification, and prints a one-time
// password-reset link (valid 30 minutes) so the administrator chooses their own password. Every use is audited.
import { q, tx, type Pool } from './db'; import { audit } from './platform/audit'; import { newToken, sha256, uuid } from './platform/crypto';
export class RecoveryError extends Error {}
export async function recoverAdmin(pool: Pool, o: { email: string; resetMfa: boolean; origin: string; minutes?: number }): Promise<{ link: string; userId: string; mfaReset: boolean; expiresInMinutes: number }> {
  const email = o.email.trim().toLowerCase(); const minutes = Math.min(120, Math.max(5, o.minutes ?? 30));
  if (!/^https?:\/\//.test(o.origin)) throw new RecoveryError('APP_ORIGIN must be set to the public address, for example https://grc.example.com');
  return tx(pool, async (c) => {
    const u = (await q(c, "SELECT id, platform_role role FROM users WHERE email=? AND status='active' FOR UPDATE", [email]))[0];
    if (!u || !['super_admin', 'admin'].includes(u.role)) throw new RecoveryError('No active administrator has that email address');   // never used for ordinary accounts
    const token = newToken(); await c.query('UPDATE password_resets SET used_at=NOW(3) WHERE user_id=? AND used_at IS NULL', [u.id]);
    await c.query('INSERT INTO password_resets(id,user_id,token_hash,expires_at) VALUES (?,?,?,?)', [uuid(), u.id, sha256(token), new Date(Date.now() + minutes * 60_000)]);
    await c.query('UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=?', [u.id]); await c.query('DELETE FROM sessions WHERE user_id=?', [u.id]);
    if (o.resetMfa) { await c.query('DELETE FROM mfa_secrets WHERE user_id=?', [u.id]); await c.query('DELETE FROM recovery_codes WHERE user_id=?', [u.id]); }
    await audit(c, { actorId: null, action: 'auth.admin_recovery', entity: 'user', entityId: u.id, detail: { mfaReset: o.resetMfa, by: 'server operator' } });
    return { link: `${o.origin.replace(/\/+$/, '')}/reset-password?token=${encodeURIComponent(token)}`, userId: u.id as string, mfaReset: o.resetMfa, expiresInMinutes: minutes };
  });
}
