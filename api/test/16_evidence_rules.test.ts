import { test } from 'node:test'; import assert from 'node:assert/strict';
import { REQUEST_STATUS, deriveItemEvidence, canManageRequests, canUpload, canViewContent, canReview, canScan, reviewCheck, addMonths, isExpired, checkFile, checkLink, sanitizeFileName, extOf, type Who, type ReqStatus } from '../src/modules/evidence/rules';
import { evaluateItem } from '../src/modules/engagements/evaluation';

test('item evidence derivation: every multiset of up to 4 requests agrees with an independently written oracle', () => {
  const oracle = (s: ReqStatus[]) => { const a = s.filter(x => x !== 'cancelled'); const n = (k: string) => a.filter(x => x === k).length; if (!a.length) return 'not_requested'; if (n('accepted') === a.length) return 'accepted'; if (n('rejected')) return 'rejected'; if (n('submitted')) return 'submitted'; return n('accepted') ? 'in_progress' : 'requested'; };
  const gen = (k: number): ReqStatus[][] => k === 0 ? [[]] : gen(k - 1).flatMap(p => REQUEST_STATUS.map(s => [...p, s])); let n = 0;
  for (let k = 0; k <= 4; k++) for (const s of gen(k)) { assert.equal(deriveItemEvidence(s), oracle(s), s.join(',')); n++; } assert.ok(n > 700);
});
test('conservatism: a derived status can only become "effective" through accepted evidence on an implemented item', () => {
  const gen = (k: number): ReqStatus[][] => k === 0 ? [[]] : gen(k - 1).flatMap(p => REQUEST_STATUS.map(s => [...p, s]));
  for (let k = 0; k <= 3; k++) for (const s of gen(k)) { const ev = deriveItemEvidence(s); const st = evaluateItem({ readiness: 'implemented', evidence: ev }); if (st === 'effective') assert.ok(s.some(x => x === 'accepted') && s.every(x => x === 'accepted' || x === 'cancelled')); }
});
const whos: Who[] = []; for (const via of ['member', 'staff'] as const) for (const role of ['client_admin', 'client_staff', 'third_party_vendor', 'tp_auditor', 'isecurify_staff']) for (const manage of [true, false]) for (const readEvidence of [true, false]) whos.push({ via, role, manage, readEvidence });
test('permission matrix (exhaustive over role x manage x readEvidence)', () => {
  for (const w of whos) {
    const provider = w.via === 'member' && (w.role === 'client_staff' || w.role === 'third_party_vendor');
    assert.equal(canManageRequests(w), w.manage);
    for (const own of [true, false]) { assert.equal(canUpload(w, 'u', own ? 'u' : 'z'), w.manage || (provider && own)); assert.equal(canViewContent(w, 'u', own ? 'u' : 'z'), w.via === 'staff' ? w.readEvidence : w.role === 'client_admin' || w.role === 'tp_auditor' || (provider && own)); }
    assert.equal(canUpload(w, 'u', null), w.manage); assert.equal(canReview(w), (w.via === 'member' && w.role === 'tp_auditor') || (w.via === 'staff' && w.manage && w.readEvidence)); assert.equal(canScan(w), canReview(w) || w.manage);
    if (w.via === 'member' && w.role === 'client_admin') assert.equal(canReview(w), false, 'client admins never judge evidence');
    if (w.role === 'tp_auditor') assert.equal(canUpload(w, 'u', 'u'), w.manage, 'auditors never upload');
  }
});
test('review state machine', () => {
  for (const s of REQUEST_STATUS) for (const d of ['accepted', 'rejected'] as const) for (const latest of [true, false]) {
    const r = reviewCheck(s, d, latest); const expect = (s === 'submitted' || s === 'accepted' || s === 'rejected') && latest && s !== d; assert.equal(r.ok, expect, `${s}/${d}/${latest}`);
  }
});
test('calendar arithmetic and expiry day', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28'); assert.equal(addMonths('2028-01-31', 1), '2028-02-29'); assert.equal(addMonths('2026-10-22', 12), '2027-10-22'); assert.equal(addMonths('2026-11-30', 3), '2027-02-28'); assert.equal(addMonths('2026-12-15', 1), '2027-01-15'); assert.equal(addMonths('2026-03-31', 120), '2036-03-31');
  assert.equal(isExpired('2026-10-22', '2026-10-22'), false, 'valid through the date itself'); assert.equal(isExpired('2026-10-21', '2026-10-22'), true); assert.equal(isExpired(null, '2026-10-22'), false);
});
test('file policy: extension allow-list plus content sniffing', () => {
  const pdf = Buffer.from('%PDF-1.7\n'); const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]); const zip = Buffer.from([0x50, 0x4b, 3, 4, 0]); const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  for (const [n, b] of [['a.pdf', pdf], ['a.PNG', png], ['a.docx', zip], ['a.xlsx', zip], ['a.xls', ole], ['a.jpg', jpg], ['a.csv', Buffer.from('a,b\n1,2')], ['a.json', Buffer.from('{}')]] as const) assert.equal(checkFile(n, b, b.length).ok, true, n);
  for (const [n, b] of [['a.exe', pdf], ['a.html', Buffer.from('<script>')], ['a.svg', Buffer.from('<svg>')], ['a', pdf], ['a.pdf', png], ['a.png', pdf], ['a.docx', pdf], ['a.csv', Buffer.from('a\0b')], ['a.txt', Buffer.from('MZ....')], ['a.txt', Buffer.from('#!/bin/sh')], ['a.txt', Buffer.from([0x7f, 0x45, 0x4c, 0x46])]] as const) assert.equal(checkFile(n, b, b.length).ok, false, n);
  assert.equal(checkFile('a.pdf', pdf, 0).ok, false); assert.equal(extOf('archive.tar.GZ'), 'gz'); assert.equal(extOf('noext'), '');
});
test('file names: directories, control characters and over-long names are neutralised', () => {
  assert.equal(sanitizeFileName('../../etc/passwd'), 'passwd'); assert.equal(sanitizeFileName('C:\\x\\evil.pdf'), 'evil.pdf'); assert.equal(sanitizeFileName('a"b<c>|d.pdf'), 'abcd.pdf'); assert.equal(sanitizeFileName('  ..hidden. '), 'hidden'); assert.equal(sanitizeFileName(''), 'file'); assert.equal(sanitizeFileName('x\u0000y.pdf'), 'xy.pdf');
  const long = sanitizeFileName('a'.repeat(400) + '.pdf'); assert.ok(long.length <= 180 && long.endsWith('.pdf'));
});
test('link policy', () => {
  assert.equal(checkLink('https://drive.google.com/file/d/1/view').ok, true); assert.equal((checkLink('https://x.sharepoint.com/a') as any).provider, 'microsoft'); assert.equal((checkLink('https://www.dropbox.com/s/a') as any).provider, 'dropbox'); assert.equal((checkLink('https://example.org/a') as any).provider, 'other');
  for (const b of ['http://a.com', 'ftp://a.com', 'https://a', 'https://10.0.0.1/x', 'https://u:p@a.com', 'https://a.local/x', 'https://x.internal/y', 'data:text/html,hi', '  ', 'a'.repeat(2100)]) assert.equal(checkLink(b).ok, false, b);
  assert.equal(checkLink('https://drive.google.com/x', ['drive.google.com']).ok, true); assert.equal(checkLink('https://evil.com/x', ['drive.google.com']).ok, false); assert.equal(checkLink('https://a.drive.google.com/x', ['drive.google.com']).ok, true); assert.equal(checkLink('https://notdrive.google.com.evil.com/x', ['drive.google.com']).ok, false);
});
