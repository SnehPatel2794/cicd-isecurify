import { fmtBytes, requestLabel, requestTone, checkPick, usagePercent, usageTone, shortHash, sha256Hex, ITEM_EVIDENCE_LABEL, ITEM_EVIDENCE_TONE, SCAN_LABEL, REQUEST_LABEL, REQUEST_TONE } from './evidenceUi';
test('sizes are human readable', () => { expect(fmtBytes(0)).toBe('0 B'); expect(fmtBytes(1536)).toBe('2 KB'); expect(fmtBytes(5 * 1048576)).toBe('5.0 MB'); expect(fmtBytes(2 * 1073741824)).toBe('2.0 GB'); expect(fmtBytes(null)).toBe('—'); });
test('accepted-but-expired evidence is shown as expired, not accepted', () => { expect(requestLabel({ status: 'accepted', expired: true })).toBe('Expired'); expect(requestTone({ status: 'accepted', expired: true })).toBe('amber'); expect(requestLabel({ status: 'accepted' })).toBe('Accepted'); expect(requestTone({ status: 'rejected' })).toBe('red'); });
test('every status has a label and a tone', () => { for (const s of ['requested', 'submitted', 'accepted', 'rejected', 'cancelled']) { expect(REQUEST_LABEL[s]).toBeDefined(); expect(REQUEST_TONE[s]).toBeDefined(); } for (const s of ['not_requested', 'requested', 'in_progress', 'submitted', 'accepted', 'rejected']) { expect(ITEM_EVIDENCE_LABEL[s]).toBeDefined(); expect(ITEM_EVIDENCE_TONE[s]).toBeDefined(); } for (const s of ['not_scanned', 'clean', 'infected', 'error']) expect(SCAN_LABEL[s]).toBeDefined(); expect(SCAN_LABEL.infected[1]).toBe('red'); });
test('file pre-check mirrors the server rules', () => {
  const ok = ['pdf', 'png', 'csv']; expect(checkPick('a.pdf', 10, 100, ok)).toBeNull(); expect(checkPick('a.exe', 10, 100, ok)).toMatch(/\.exe/); expect(checkPick('noext', 10, 100, ok)).toMatch(/not accepted/); expect(checkPick('a.PDF', 10, 100, ok)).toBeNull(); expect(checkPick('a.pdf', 0, 100, ok)).toMatch(/empty/); expect(checkPick('a.pdf', 101, 100, ok)).toMatch(/larger/);
});
test('storage usage', () => { expect(usagePercent(50, 200)).toBe(25); expect(usagePercent(300, 200)).toBe(100); expect(usagePercent(1, 0)).toBe(100); expect(usageTone(50)).toBe('green'); expect(usageTone(80)).toBe('amber'); expect(usageTone(96)).toBe('red'); });
test('hash display and computation', async () => { expect(shortHash('a'.repeat(64))).toBe('aaaaaaaaaa…aaaa'); expect(shortHash(null)).toBe('—'); const h = await sha256Hex(new TextEncoder().encode('abc').buffer as ArrayBuffer); expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'); });

import { groupTemplates, templateOption } from './evidenceUi';
test('templates are grouped by category, uncategorised last, order kept inside a group', () => {
  const g = groupTemplates([{ category: 'Policies', n: 1 }, { category: null, n: 2 }, { category: 'Forms', n: 3 }, { category: ' Policies ', n: 4 }, { category: 'Policies', n: 5 }] as any);
  expect(g.map(x => x.category)).toEqual(['Forms', 'Policies', 'Uncategorised']); expect((g[1].items as any[]).map(x => x.n)).toEqual([1, 4, 5]);   // surrounding spaces do not create a separate group
  expect(groupTemplates([])).toEqual([]);
});
test('template option text carries version and framework', () => { expect(templateOption({ id: '1', name: 'ISMS', versionLabel: 'v2', frameworkName: 'ISO 27001', category: null, active: 1 })).toBe('ISMS · v2 (ISO 27001)'); expect(templateOption({ id: '1', name: 'ISMS', versionLabel: null, frameworkName: null, category: null, active: 1 })).toBe('ISMS'); });
