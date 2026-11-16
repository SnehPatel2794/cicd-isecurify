import { q, type Conn } from '../../db';
import { uuid } from '../../platform/crypto';
import { HttpError, notFound } from '../../platform/errors';
import type { ControlInput } from './importer';

const COLS = 'id,ref,domain,title,description,owner_department,secondary_guidance_note,remarks';
export const getRelease = async (c: Conn, id: string, lock = false) =>
  (await q(c, `SELECT r.*, f.name framework_name, f.archived framework_archived FROM framework_releases r JOIN frameworks f ON f.id=r.framework_id WHERE r.id=? ${lock ? 'FOR UPDATE' : ''}`, [id]))[0] ?? null;

/** Loads a release for EDITING inside a transaction: must exist, be a draft, and belong to a non-archived framework. */
export async function requireDraft(c: Conn, id: string) {
  const r = await getRelease(c, id, true); if (!r) throw notFound();
  if (r.status === 'published') throw new HttpError(409, 'Published releases are immutable. Create a new draft release to make changes.', 'release_immutable');
  if (r.framework_archived) throw new HttpError(409, 'This framework is archived. Restore it before editing.', 'framework_archived');
  return r;
}
export async function insertControls(c: Conn, releaseId: string, rows: ControlInput[]) {
  const start = (await q(c, 'SELECT COALESCE(MAX(sort_order),0) m FROM framework_controls WHERE release_id=?', [releaseId]))[0].m as number;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map((r, j) => [uuid(), releaseId, r.ref, r.domain, r.title, r.description, r.ownerDepartment, r.secondaryGuidanceNote, r.remarks, start + i + j + 1]);
    await c.query('INSERT INTO framework_controls(id,release_id,ref,domain,title,description,owner_department,secondary_guidance_note,remarks,sort_order) VALUES ?', [batch]);
  }
}
export const existingRefs = async (c: Conn, releaseId: string) => new Set((await q(c, 'SELECT ref FROM framework_controls WHERE release_id=?', [releaseId])).map(r => String(r.ref).toLowerCase()));

/** New draft = copy of a published release (controls AND their common-control mappings). The source release is never touched. */
export async function createDraftFrom(c: Conn, source: any, actorId: string) {
  const fw = (await q(c, 'SELECT id FROM frameworks WHERE id=? FOR UPDATE', [source.framework_id]))[0]; if (!fw) throw notFound();
  if ((await q(c, "SELECT 1 x FROM framework_releases WHERE framework_id=? AND status='draft'", [source.framework_id]))[0]) throw new HttpError(409, 'A draft release already exists for this framework', 'draft_exists');
  const version = (await q(c, 'SELECT MAX(version)+1 v FROM framework_releases WHERE framework_id=?', [source.framework_id]))[0].v as number; const id = uuid();
  await c.query('INSERT INTO framework_releases(id,framework_id,version,based_on_release_id) VALUES (?,?,?,?)', [id, source.framework_id, version, source.id]);
  const old = await q(c, 'SELECT * FROM framework_controls WHERE release_id=? ORDER BY sort_order,ref', [source.id]); const map = new Map<string, string>();
  for (let i = 0; i < old.length; i += 500) {
    const batch = old.slice(i, i + 500).map(o => { const nid = uuid(); map.set(o.id, nid); return [nid, id, o.ref, o.domain, o.title, o.description, o.owner_department, o.secondary_guidance_note, o.remarks, o.sort_order]; });
    await c.query('INSERT INTO framework_controls(id,release_id,ref,domain,title,description,owner_department,secondary_guidance_note,remarks,sort_order) VALUES ?', [batch]);
  }
  const maps = await q(c, 'SELECT m.* FROM control_mappings m JOIN framework_controls fc ON fc.id=m.control_id WHERE fc.release_id=?', [source.id]);
  for (const m of maps) {
    await c.query('INSERT INTO control_mappings(control_id,common_control_id,rationale,mapped_by) VALUES (?,?,?,?)', [map.get(m.control_id), m.common_control_id, m.rationale, actorId]);
    await c.query("INSERT INTO control_mapping_history(control_id,common_control_id,action,rationale,actor_id) VALUES (?,?, 'map', ?, ?)", [map.get(m.control_id), m.common_control_id, 'copied from release v' + source.version, actorId]);
  }
  return { id, version, controls: old.length };
}

const FIELDS = ['domain', 'title', 'description', 'owner_department', 'secondary_guidance_note', 'remarks'] as const;
/** Deterministic comparison: ordering is by code-point order of `ref`, never by locale or insertion order. */
export async function compareReleases(c: Conn, fromId: string, toId: string) {
  const load = async (id: string) => new Map((await q(c, `SELECT ${COLS} FROM framework_controls WHERE release_id=?`, [id])).map(r => [r.ref as string, r]));
  const [a, b] = await Promise.all([load(fromId), load(toId)]); const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  const added = [...b.keys()].filter(k => !a.has(k)).sort(cmp).map(k => ({ ref: k, domain: b.get(k).domain, title: b.get(k).title }));
  const removed = [...a.keys()].filter(k => !b.has(k)).sort(cmp).map(k => ({ ref: k, domain: a.get(k).domain, title: a.get(k).title }));
  const changed: any[] = []; let unchanged = 0;
  for (const k of [...a.keys()].filter(k => b.has(k)).sort(cmp)) {
    const diffs = FIELDS.filter(f => (a.get(k)[f] ?? null) !== (b.get(k)[f] ?? null)).map(f => ({ field: f, from: a.get(k)[f] ?? null, to: b.get(k)[f] ?? null }));
    diffs.length ? changed.push({ ref: k, changes: diffs }) : unchanged++;
  }
  return { added, removed, changed, unchanged, summary: { added: added.length, removed: removed.length, changed: changed.length, unchanged } };
}
