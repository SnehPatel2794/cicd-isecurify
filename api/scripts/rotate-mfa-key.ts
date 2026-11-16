// Usage (API stopped):  OLD_MFA_ENC_KEY=... NEW_MFA_ENC_KEY=... DATABASE_URL=... npx tsx scripts/rotate-mfa-key.ts [--apply]
// Without --apply it only checks that every stored secret can be re-encrypted. After --apply, put the new key in .env and start the API.
import { makePool } from '../src/db'; import { rotateMfaKey, parseKey } from '../src/rotatekey';
const url = process.env.DATABASE_URL; if (!url) { console.error('DATABASE_URL is required'); process.exit(2); }
const pool = makePool(url);
try { const r = await rotateMfaKey(pool, parseKey(process.env.OLD_MFA_ENC_KEY ?? '', 'OLD_MFA_ENC_KEY'), parseKey(process.env.NEW_MFA_ENC_KEY ?? '', 'NEW_MFA_ENC_KEY'), process.argv.includes('--apply'));
  console.log(r.applied ? `Re-encrypted ${r.secrets} secret(s). Now set MFA_ENC_KEY to the new key in .env and start the API.` : `Dry run: ${r.secrets} secret(s) can be re-encrypted. Run again with --apply.`);
} catch (e: any) { console.error(e.message); process.exitCode = 1; } finally { await pool.end(); }
