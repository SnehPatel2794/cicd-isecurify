import { groupByDomain } from './groupBy';
test('groups by domain preserving first-seen order', () => { const g = groupByDomain([{ domain: 'B', n: 1 }, { domain: 'A', n: 2 }, { domain: 'B', n: 3 }]); expect(g.map(x => x.domain)).toEqual(['B', 'A']); expect(g[0].items.map(i => i.n)).toEqual([1, 3]); });
test('empty input gives no groups', () => { expect(groupByDomain([])).toEqual([]); });
