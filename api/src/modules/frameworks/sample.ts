import { q, tx, type Pool } from '../../db'; import { uuid } from '../../platform/crypto'; import { audit } from '../../platform/audit';
// FICTIONAL sample content for demos and tests ONLY. Not derived from ISO, SOC 2, PCI, HIPAA or any other standard. Real frameworks must be imported
// by iSecurify from content it is licensed to use (see docs/LICENSING.md).
export const SAMPLE_NAME = 'Sample Security Framework (fictional)';
const COMMON = [['Multi-factor authentication', 'Strong authentication is required for privileged and remote access.'], ['Periodic access review', 'Access rights are reviewed on a fixed schedule and unnecessary access is removed.'],
  ['Backup and recovery testing', 'Backups are taken and restores are tested.'], ['Incident response plan', 'A documented plan exists to detect, respond to and learn lessons from security events.'], ['Security awareness training', 'Staff receive security training at onboarding and periodically.']];
const CONTROLS: [string, string, string, string | null][] = [['SAMPLE-1.1', 'Governance', 'A security policy is approved by management and reviewed yearly.', null], ['SAMPLE-1.2', 'Governance', 'Security roles and responsibilities are assigned.', null],
  ['SAMPLE-2.1', 'Access control', 'Multi-factor authentication protects administrator and remote access.', 'Multi-factor authentication'], ['SAMPLE-2.2', 'Access control', 'User access is reviewed every quarter.', 'Periodic access review'],
  ['SAMPLE-3.1', 'Operations', 'Backups run daily and a restore test is performed twice a year.', 'Backup and recovery testing'], ['SAMPLE-3.2', 'Operations', 'An incident response plan is documented and exercised.', 'Incident response plan'],
  ['SAMPLE-4.1', 'People', 'New joiners and staff complete security awareness training.', 'Security awareness training'], ['SAMPLE-4.2', 'People', 'Access is revoked on the day a person leaves.', null]];
/** Idempotent: does nothing if the sample framework exists. Returns what it created. */
export async function seedSample(pool: Pool, actorId: string) {
  if ((await q(pool, 'SELECT 1 x FROM frameworks WHERE name=?', [SAMPLE_NAME]))[0]) return { created: false };
  return tx(pool, async (c) => {
    const fid = uuid(), rid = uuid(); const cc = new Map<string, string>();
    await c.query('INSERT INTO frameworks(id,name,region,description,color,created_by) VALUES (?,?,?,?,?,?)', [fid, SAMPLE_NAME, 'Demo', 'Fictional content for demonstrations and automated tests. Not a real standard.', '#0f766e', actorId]);
    await c.query('INSERT INTO framework_releases(id,framework_id,version) VALUES (?,?,1)', [rid, fid]);
    for (const [t, d] of COMMON) { const id = uuid(); cc.set(t, id); await c.query('INSERT INTO common_controls(id,title,description,created_by) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE id=id', [id, t, d, actorId]); }
    for (const [t] of COMMON) cc.set(t, (await q(c, 'SELECT id FROM common_controls WHERE title=?', [t]))[0].id);
    let n = 0; for (const [ref, domain, title, common] of CONTROLS) { const id = uuid(); await c.query('INSERT INTO framework_controls(id,release_id,ref,domain,title,sort_order) VALUES (?,?,?,?,?,?)', [id, rid, ref, domain, title, ++n]);
      if (common) { await c.query('INSERT INTO control_mappings(control_id,common_control_id,rationale,mapped_by) VALUES (?,?,?,?)', [id, cc.get(common), 'sample mapping', actorId]); await c.query("INSERT INTO control_mapping_history(control_id,common_control_id,action,rationale,actor_id) VALUES (?,?, 'map', 'sample mapping', ?)", [id, cc.get(common), actorId]); } }
    await c.query("UPDATE framework_releases SET status='published', published_at=NOW(3), published_by=? WHERE id=?", [actorId, rid]);
    await audit(c, { actorId, action: 'sample.seeded', entity: 'framework', entityId: fid }); return { created: true, frameworkId: fid, releaseId: rid, controls: CONTROLS.length, commonControls: COMMON.length };
  });
}
