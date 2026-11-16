// Usage (on the server, in the project folder):
//   docker compose run --rm api npx tsx scripts/recover-admin.ts --email admin@your-domain.com [--reset-mfa] [--minutes=30]
// Unlocks an administrator who is locked out, ends their sessions and prints a one-time password-reset link. --reset-mfa also removes their two-step
// verification (use it only when the authenticator device AND the recovery codes are lost); they enrol again at the next sign-in.
import { makePool } from '../src/db'; import { recoverAdmin, RecoveryError } from '../src/recovery';
const arg = (n: string) => { const i = process.argv.findIndex(a => a === `--${n}` || a.startsWith(`--${n}=`)); if (i < 0) return undefined; const a = process.argv[i]; return a.includes('=') ? a.split('=')[1] : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : ''); };
const email = arg('email'); const url = process.env.DATABASE_URL; if (!email || !url) { console.error('Usage: recover-admin.ts --email <address> [--reset-mfa] [--minutes=30]   (DATABASE_URL must be set)'); process.exit(2); }
const pool = makePool(url);
try { const r = await recoverAdmin(pool, { email, resetMfa: process.argv.includes('--reset-mfa'), origin: process.env.APP_ORIGIN || '', minutes: Number(arg('minutes')) || undefined });
  console.log(`Account unlocked and sessions ended.${r.mfaReset ? ' Two-step verification was removed.' : ''}\nOne-time link (valid ${r.expiresInMinutes} minutes, works once). Give it only to the administrator:\n\n${r.link}\n`);
} catch (e: any) { console.error(e instanceof RecoveryError ? e.message : 'Recovery failed: ' + e.message); process.exitCode = 1; } finally { await pool.end(); }
