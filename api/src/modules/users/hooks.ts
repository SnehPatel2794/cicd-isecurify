import type { Conn } from '../../db';
// Extension points so later phases plug in without editing this module (and without circular imports).
export type Blocker = { type: string; id: string; label: string };
export type ManifestSection = { title: string; headers: string[]; rows: string[][] };
/** Phase 4+ registers a blocker that lists open checklist items the user is accountable for. tenantId=null means "anywhere". */
export const deletionBlockers: Array<(c: Conn, userId: string, tenantId: string | null) => Promise<Blocker[]>> = [];
/** Phase 5/6 register sections listing the user's uploaded evidence, comments and findings. */
export const manifestProviders: Array<(c: Conn, userId: string) => Promise<ManifestSection>> = [];
export async function collectBlockers(c: Conn, userId: string, tenantId: string | null = null) { const out: Blocker[] = []; for (const b of deletionBlockers) out.push(...(await b(c, userId, tenantId))); return out; }
