// Lists every route the application registers (from Fastify's route tree), so security tests cover routes added later without anyone remembering to list them.
export type Route = { method: string; path: string };
export function listRoutes(app: { printRoutes: (o?: any) => string }): Route[] {
  const out: Route[] = []; const stack: string[] = [];
  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const m = /^((?:[│ ]   )*)(?:├──|└──) (\S*)(?: \(([^)]*)\))?\s*$/.exec(line); if (!m) continue; const depth = m[1].length / 4; stack.length = depth; stack[depth] = m[2];
    if (m[3]) for (const method of m[3].split(',').map(s => s.trim())) if (method !== 'HEAD' && method !== 'OPTIONS') out.push({ method, path: stack.slice(0, depth + 1).join('') });
  }
  return out;
}
export const withIds = (path: string, tenantId: string, id = '00000000-0000-4000-8000-000000000001') => path.replace(':tenantId', tenantId).replace(/:[A-Za-z]+/g, id);
/** Every query-string name the code reads: keys of z.object({...}) schemas in the source, plus the ones the shared filters define. */
export function queryKeys(files: { text: string }[]): string[] {
  const keys = new Set<string>(); for (const f of files) for (const m of f.text.matchAll(/\b([a-z][A-Za-z0-9]{0,30}):\s*(?:z\.|Uuid|Text\(|Day\b|Word\b|Stamp\b|Id\b)/g)) keys.add(m[1]); return [...keys].sort();
}
