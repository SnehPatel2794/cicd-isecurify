// Usage: DATABASE_URL=... [EVIDENCE_DIR=...] [MIGRATIONS_DIR=...] npx tsx scripts/verify-restore.ts [--json] [--sample=N]
// Exits 0 when the restored data is complete and consistent, 1 otherwise. Never writes.
import { makePool } from '../src/db'; import { runRestoreChecks } from '../src/restorecheck'; import { MIGRATIONS_DIR } from '../src/migrate';
const url = process.env.DATABASE_URL; if (!url) { console.error('DATABASE_URL is required'); process.exit(2); }
const json = process.argv.includes('--json'); const sample = Number((process.argv.find(a => a.startsWith('--sample=')) ?? '').split('=')[1]) || undefined; const pool = makePool(url);
try { const r = await runRestoreChecks(pool, { migrationsDir: MIGRATIONS_DIR, evidenceDir: process.env.EVIDENCE_DIR, sampleFiles: sample });
  if (json) console.log(JSON.stringify(r, null, 2)); else { for (const c of r.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(15)} ${c.detail}`); console.log('\nRow counts: ' + Object.entries(r.counts).map(([k, v]) => `${k}=${v}`).join(', ')); console.log(r.ok ? '\nRESTORE VERIFIED' : '\nRESTORE CHECK FAILED'); }
  process.exitCode = r.ok ? 0 : 1; } catch (e: any) { console.error('Could not run the checks: ' + e.message); process.exitCode = 2; } finally { await pool.end(); }
