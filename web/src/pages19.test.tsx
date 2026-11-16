import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { vi } from 'vitest';
vi.mock('./api', () => ({ api: vi.fn(), ApiError: class extends Error { constructor(public status: number, m: string) { super(m); } } }));
import { api } from './api'; import { StoragePage, QuarantinePage } from './pages19'; import { quotaText, diskText, holdProblem, retentionText } from './storageUi'; import { UsageBar } from './pages5';
const wrap = (ui: React.ReactNode, path = '/') => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><Routes><Route path="/org/:tid/quarantine" element={ui} /><Route path="*" element={ui} /></Routes></MemoryRouter></QueryClientProvider>);
beforeEach(() => vi.clearAllMocks());
const ORG = (o: any = {}) => ({ id: 'o1', name: 'Acme', status: 'active', retentionMonths: 84, legalHold: false, legalHoldReason: null, usedBytes: 5 * 1048576, versionCount: 3, quotaBytes: null, unlimited: true, quotaIsDefault: true, archivedEngagements: 0, infectedFiles: 0, heldEngagements: 0, ...o });
const S = (o: any = {}) => ({ disk: { freeBytes: 50 * 1073741824, totalBytes: 100 * 1073741824, minFreeBytes: 1073741824, low: false }, defaults: { quotaBytes: null, maxFileBytes: 25 * 1048576, minFreeBytes: 1073741824 }, totals: { usedBytes: 5 * 1048576, versionCount: 3, infectedFiles: 0, archivedEngagements: 0 }, orgs: [ORG()], heldEngagements: [], archived: [], quarantine: [], ...o });
const serve = (s: any) => (api as any).mockImplementation(async (m: string) => m === 'GET' ? s : { ok: true });

test('helpers: wording for limits, disk, holds and retention', () => {
  expect(quotaText({ unlimited: true, quotaBytes: null, quotaIsDefault: true })).toBe('No limit'); expect(quotaText({ unlimited: false, quotaBytes: 5 * 1048576, quotaIsDefault: false })).toMatch(/5.0 MB \(set for this organization\)/);
  expect(diskText(null)).toMatch(/not available/); expect(diskText({ freeBytes: 1073741824, totalBytes: 2147483648, low: true })).toMatch(/uploads are paused/);
  expect(holdProblem('ab')).not.toBeNull(); expect(holdProblem('Court order')).toBeNull(); expect(holdProblem('x'.repeat(301))).toMatch(/too long/); expect(retentionText(84)).toBe('7 years'); expect(retentionText(12)).toBe('1 year'); expect(retentionText(18)).toBe('18 months');
});
test('usage bar says "no limit" instead of a full red bar when there is no quota', () => { render(<UsageBar usage={{ usedBytes: 2 * 1048576, quotaBytes: null }} />); expect(screen.getByLabelText('Evidence storage')).toHaveTextContent('2.0 MB used · no limit'); expect(screen.queryByRole('img')).toBeNull(); });
test('overview: disk, defaults, one row per organization', async () => {
  serve(S()); wrap(<StoragePage />); const ov = await screen.findByLabelText('Overview'); expect(ov).toHaveTextContent('50.0 GB free of 100.0 GB'); expect(ov).toHaveTextContent('Default limit per organization: no limit'); expect(within(screen.getByLabelText('Organizations')).getByText('Acme')).toBeInTheDocument(); expect(screen.getByText('7 years')).toBeInTheDocument();
});
test('low disk is called out', async () => { serve(S({ disk: { freeBytes: 1, totalBytes: 100, minFreeBytes: 5, low: true } })); wrap(<StoragePage />); expect(await screen.findByLabelText('Overview')).toHaveTextContent('uploads are paused'); });
test('legal hold needs a reason, then is sent; release is one click', async () => {
  serve(S({ orgs: [ORG(), ORG({ id: 'o2', name: 'Beta', legalHold: true, legalHoldReason: 'Court order' })] })); wrap(<StoragePage />); await screen.findByLabelText('Organizations');
  fireEvent.click(screen.getByRole('button', { name: 'Legal hold' })); const d = await screen.findByRole('dialog'); const go = within(d).getByRole('button', { name: 'Place hold' }); expect(go).toBeDisabled();
  fireEvent.change(within(d).getByLabelText('Reason'), { target: { value: 'Regulator request' } }); fireEvent.click(go); await waitFor(() => expect(api).toHaveBeenCalledWith('PUT', '/platform/organizations/o1/legal-hold', { hold: true, reason: 'Regulator request' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Release hold' })); await waitFor(() => expect(api).toHaveBeenCalledWith('PUT', '/platform/organizations/o2/legal-hold', { hold: false }));
});
test('limit: empty restores the default, a number sets it, junk is refused', async () => {
  serve(S()); wrap(<StoragePage />); fireEvent.click(await screen.findByRole('button', { name: 'Limit' })); const d = await screen.findByRole('dialog'); const save = within(d).getByRole('button', { name: 'Save' });
  fireEvent.change(within(d).getByLabelText('Limit in MB'), { target: { value: '12x' } }); expect(save).toBeDisabled(); fireEvent.change(within(d).getByLabelText('Limit in MB'), { target: { value: '500' } }); fireEvent.click(save);
  await waitFor(() => expect(api).toHaveBeenCalledWith('PUT', '/platform/organizations/o1/evidence-quota', { quotaMb: 500 }));
});
test('archived engagements can be restored; held engagements released', async () => {
  serve(S({ archived: [{ tenantId: 'o1', orgName: 'Acme', engagementId: 'e1', name: 'FY24 audit', archivedAt: '2026-10-01T00:00:00Z', requestCount: 12 }], heldEngagements: [{ tenantId: 'o1', orgName: 'Acme', id: 'e2', name: 'Probe', reason: 'Investigation', since: '2026-10-01' }] })); wrap(<StoragePage />);
  const arch = await screen.findByLabelText('Archived engagements'); expect(arch).toHaveTextContent('FY24 audit'); fireEvent.click(within(arch).getByRole('button', { name: 'Restore' })); await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/platform/organizations/o1/engagements/e1/restore-archive'));
  fireEvent.click(within(screen.getByLabelText('Held engagements')).getByRole('button', { name: 'Release hold' })); await waitFor(() => expect(api).toHaveBeenCalledWith('PUT', '/platform/organizations/o1/engagements/e2/legal-hold', { hold: false }));
});
test('quarantine: platform list shows organization, file, signature; empty state otherwise', async () => {
  serve(S({ quarantine: [{ versionId: 'v1', orgName: 'Acme', fileName: 'a.pdf', versionNo: 2, sizeBytes: 2048, requestTitle: 'Policy', uploadedBy: 'Ann', signature: 'Eicar-Test', detectedAt: '2026-10-01T10:00:00Z' }] })); wrap(<StoragePage />);
  const q = await screen.findByLabelText('Quarantine'); expect(q).toHaveTextContent('a.pdf'); expect(q).toHaveTextContent('Eicar-Test'); expect(q).toHaveTextContent('Ann');
});
test('organization quarantine page: lists flagged files, or says none', async () => {
  (api as any).mockImplementation(async () => ({ files: [] })); wrap(<QuarantinePage />, '/org/t1/quarantine'); expect(await screen.findByText('No file has been flagged by the malware scan.')).toBeInTheDocument();
});
