export type Ctl = { id: string; ref: string; domain: string; title: string; [k: string]: unknown };
/** Groups controls by domain, keeping the order in which domains first appear (the server already sorts by domain, sort_order, ref). */
export function groupByDomain<T extends { domain: string }>(items: T[]): { domain: string; items: T[] }[] {
  const out: { domain: string; items: T[] }[] = []; const idx = new Map<string, number>();
  for (const it of items) { let i = idx.get(it.domain); if (i === undefined) { i = out.length; idx.set(it.domain, i); out.push({ domain: it.domain, items: [] }); } out[i].items.push(it); }
  return out;
}
