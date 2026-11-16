// Restore proof (Phase 12A). Not a unit test: run by hand, prints the evidence that goes into docs/RESTORE_EVIDENCE.md.
// Builds a populated database with real evidence files through the API, takes a backup in the same format as deploy/backup.sh
// (gzip'd mysqldump + tar.gz of the evidence folder + sha256 manifest), restores it into a NEW empty database and runs scripts/verify-restore.ts.
// Then it damages the backup in three ways and shows that each is caught. Usage: MIGRATIONS_DIR=... node --import tsx test/restore_proof.ts <outdir>
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import crypto from 'node:crypto'; import { execSync, spawnSync } from 'node:child_process';
import mysql from 'mysql2/promise';
import { freshEnv, world, frameworkFixtures, mpf, PDF, ADMIN_URL } from './helpers';
const out = path.resolve(process.argv[2] || './restore-proof'); fs.mkdirSync(out, { recursive: true });
const log: string[] = []; const say = (s = '') => { console.log(s); log.push(s); };
const evDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-ev-'));
const env = await freshEnv({ requireMfaForPlatform: false, evidence: { dir: evDir, scannerEnabled: false, maxFileBytes: 5 * 1048576, defaultQuotaBytes: null } } as any);
const w = await world(env); const fx = await frameworkFixtures(w.root); const url = (p: string) => `/t/${w.A}${p}`;
const admin = await w.as('aAdmin'); const vendor = await w.as('aVendor');
const E = (await admin.call('POST', url('/engagements'), { name: 'Restore proof', primaryReleaseId: fx.X.releaseId })).body.id;
const items = (await admin.call('GET', url(`/engagements/${E}/checklist`))).body.items as any[];
let files = 0;
for (const it of items.slice(0, 5)) {
  await admin.call('PATCH', url(`/checklist/${it.id}`), { accountableUserId: w.ids.aVendor });
  const r = await admin.call('POST', url(`/checklist/${it.id}/evidence-requests`), { title: 'Proof ' + it.id.slice(0, 4) });
  const m = mpf(`doc-${files}.pdf`, PDF('restore proof ' + files), {}); const u = await vendor.call('POST', url(`/evidence-requests/${r.body.id}/versions`), m.payload, m.headers); if (u.status === 201) files++;
}
const q = async (sql: string, p: any[] = []) => (await env.pool.query(sql, p) as any)[0] as any[];
const live = { users: (await q('SELECT COUNT(*) n FROM users'))[0].n, audit: (await q('SELECT COUNT(*) n FROM audit_events'))[0].n, versions: (await q('SELECT COUNT(*) n FROM evidence_versions'))[0].n };
say(`SOURCE  database=${env.name}  users=${live.users}  audit_events=${live.audit}  evidence_versions=${live.versions}  files uploaded=${files}`);
// backup in the deploy/backup.sh layout
const stamp = '20261108T0800Z'; const B = path.join(out, 'backup'); fs.mkdirSync(B, { recursive: true });
const dbf = path.join(B, `db-${stamp}.sql.gz`); const evf = path.join(B, `evidence-${stamp}.tar.gz`); const man = path.join(B, `manifest-${stamp}.sha256`);
execSync(`mysqldump -ugrc -pgrc_test_pw -h127.0.0.1 --single-transaction --routines --triggers --databases ${env.name} | sed 's/${env.name}/grc_restored/g' | gzip > ${dbf}`, { shell: '/bin/bash' });
execSync(`tar -czf ${evf} -C ${evDir} .`); execSync(`cd ${B} && sha256sum db-${stamp}.sql.gz evidence-${stamp}.tar.gz > manifest-${stamp}.sha256`);
say(`BACKUP  ${path.basename(dbf)} ${fs.statSync(dbf).size} bytes; ${path.basename(evf)} ${fs.statSync(evf).size} bytes`); say(fs.readFileSync(man, 'utf8').trim());
const verify = (dbName: string, dir: string) => { const r = spawnSync('npx', ['tsx', 'scripts/verify-restore.ts', '--sample=25'], { env: { ...process.env, DATABASE_URL: ADMIN_URL + dbName, EVIDENCE_DIR: dir }, encoding: 'utf8' }); return { code: r.status, text: (r.stdout + r.stderr).trim() }; };
const restoreInto = async (dbName: string, dump: string) => { execSync(`mysql -uroot -e "DROP DATABASE IF EXISTS ${dbName}"`); execSync(`gunzip -c ${dump} | sed 's/grc_restored/${dbName}/g' | mysql -uroot`, { shell: '/bin/bash' }); execSync(`mysql -uroot -e "GRANT ALL ON ${dbName}.* TO 'grc'@'%'; GRANT ALL ON ${dbName}.* TO 'grc'@'localhost'; FLUSH PRIVILEGES"`); };
const unpack = (tarball: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-restored-')); execSync(`tar -xzf ${tarball} -C ${d}`); return d; };
// 1. clean restore
say('\n== 1. Restore of the untouched backup =='); say(execSync(`cd ${B} && sha256sum -c manifest-${stamp}.sha256`, { encoding: 'utf8' }).trim());
await restoreInto('grc_restored', dbf); const d1 = unpack(evf); const r1 = verify('grc_restored', d1); say(r1.text); say(`exit code ${r1.code}`);
const a = await mysql.createConnection(ADMIN_URL + 'grc_restored'); const [cnt]: any = await a.query('SELECT (SELECT COUNT(*) FROM users) users,(SELECT COUNT(*) FROM audit_events) audit,(SELECT COUNT(*) FROM evidence_versions) versions'); await a.end();
say(`RESTORED users=${cnt[0].users} audit_events=${cnt[0].audit} evidence_versions=${cnt[0].versions}  ${JSON.stringify(cnt[0]) === JSON.stringify(live) ? 'MATCHES source' : 'DIFFERS from source'}`);
// 2. damaged evidence file
say('\n== 2. One evidence file altered after backup =='); const victim = execSync(`find ${d1} -type f | head -1`, { encoding: 'utf8' }).trim(); fs.appendFileSync(victim, 'x'); const r2 = verify('grc_restored', d1); say(r2.text.split('\n').filter(l => /FAIL|PASS  files/.test(l)).join('\n')); say(`exit code ${r2.code}`);
// 3. damaged evidence file removed
say('\n== 3. One evidence file missing =='); fs.rmSync(victim); const r3 = verify('grc_restored', d1); say(r3.text.split('\n').filter(l => /FAIL|PASS  files/.test(l)).join('\n')); say(`exit code ${r3.code}`);
// 4. damaged dump: checksum refuses
say('\n== 4. Backup file damaged (checksum) =='); fs.appendFileSync(dbf, 'junk'); const c4 = spawnSync('bash', ['-c', `cd ${B} && sha256sum -c manifest-${stamp}.sha256`], { encoding: 'utf8' }); say((c4.stdout + c4.stderr).trim()); say(`exit code ${c4.status} (the drill and restore scripts stop here)`);
execSync('mysql -uroot -e "DROP DATABASE IF EXISTS grc_restored"'); await env.close();
fs.writeFileSync(path.join(out, 'restore-proof.log'), log.join('\n') + '\n'); const ok = r1.code === 0 && r2.code !== 0 && r3.code !== 0 && c4.status !== 0; say(`\nRESULT: ${ok ? 'PASS' : 'FAIL'}`); process.exit(ok ? 0 : 1);
