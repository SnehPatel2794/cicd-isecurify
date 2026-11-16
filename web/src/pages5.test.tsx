import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
vi.mock('./api', () => ({ api: vi.fn(), apiBlob: vi.fn(), apiUpload: vi.fn(), saveBlob: vi.fn(), ApiError: class extends Error {} }));
import { api, apiUpload } from './api'; import { EvidenceDrawer, EvidenceTab } from './pages5';
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const CFG = { maxFileBytes: 1048576, allowedExtensions: ['pdf', 'txt'], scannerEnabled: true, usage: { usedBytes: 100, quotaBytes: 1000, versionCount: 1, quotaIsDefault: true } };
const version = (o: any = {}) => ({ id: 'v1', versionNo: 1, kind: 'file', fileName: 'policy.pdf', sizeBytes: 2048, sha256: 'a'.repeat(64), uploadedByName: 'Vera', uploadedAt: '2026-10-01T10:00:00Z', scanStatus: 'not_scanned', note: 'first', linkUrl: null, ...o });
const request = (can: any, o: any = {}) => ({ id: 'r1', title: 'Security policy', status: 'submitted', instructions: 'Upload it', latestVersionNo: 1, validMonths: 12, versions: [version()], reviews: [], can: { upload: false, review: false, manage: false, view: true, scan: false, ...can }, ...o });
const serve = (requests: any[], extra: any = {}) => (api as any).mockImplementation(async (_m: string, url: string) => url.includes('/evidence/config') ? CFG : url.includes('/evidence') ? { item: { id: 'i1', ref: 'X-1', title: 'MFA', evidence: 'submitted' }, engagementStatus: 'active', canRequest: false, requests, ...extra } : {});
beforeEach(() => { vi.clearAllMocks(); });

test('a vendor sees an upload form but no review form; the note textarea and link field are offered', async () => {
  serve([request({ upload: true })]); wrap(<EvidenceDrawer tid="t" itemId="i1" onClose={() => {}} refresh={() => {}} />);
  expect(await screen.findByText('Security policy')).toBeInTheDocument(); expect(screen.getByLabelText('Add evidence')).toBeInTheDocument(); expect(screen.queryByLabelText('Review evidence')).toBeNull(); expect(screen.getByText('Upload version 2')).toBeInTheDocument(); expect(screen.getByText('Add link')).toBeInTheDocument();
});
test('an auditor sees the review form and cannot submit without a note', async () => {
  serve([request({ review: true })]); wrap(<EvidenceDrawer tid="t" itemId="i1" onClose={() => {}} refresh={() => {}} />);
  const btn = await screen.findByRole('button', { name: 'Accept evidence' }); expect(btn).toBeDisabled(); fireEvent.change(screen.getByLabelText(/Note \(required\)/), { target: { value: 'signed' } }); expect(btn).toBeEnabled();
  fireEvent.click(screen.getByLabelText('Reject')); expect(screen.getByRole('button', { name: 'Reject evidence' })).toBeEnabled();
  (api as any).mockImplementationOnce(async () => ({})); fireEvent.click(screen.getByRole('button', { name: 'Reject evidence' }));
  await waitFor(() => expect((api as any).mock.calls.some((c: any[]) => c[0] === 'POST' && String(c[1]).endsWith('/review') && c[2].decision === 'rejected' && c[2].note === 'signed' && c[2].versionId === 'v1')).toBe(true));
});
test('users without content access get no download button; hidden link targets are not shown; infected files cannot be downloaded', async () => {
  serve([request({ view: false }, { versions: [version({ id: 'v2', versionNo: 2, kind: 'link', fileName: null, sha256: null, linkUrl: null, linkProvider: 'google_drive' })], latestVersionNo: 2 })]); const { unmount } = wrap(<EvidenceDrawer tid="t" itemId="i1" onClose={() => {}} refresh={() => {}} />);
  expect(await screen.findByText('Link (hidden)')).toBeInTheDocument(); expect(screen.queryByText('Download')).toBeNull(); expect(screen.getByText(/Links cannot be verified/)).toBeInTheDocument(); unmount();
  serve([request({ view: true }, { versions: [version({ scanStatus: 'infected' })] })]); wrap(<EvidenceDrawer tid="t" itemId="i1" onClose={() => {}} refresh={() => {}} />);
  expect(await screen.findByText('Malware found')).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Download' })).toBeNull(); expect(screen.getByRole('button', { name: 'Verify' })).toBeInTheDocument();
});
test('links open safely in a new tab for people who may see them', async () => {
  serve([request({ view: true }, { versions: [version({ id: 'v3', kind: 'link', fileName: null, sha256: null, linkUrl: 'https://drive.google.com/x', linkProvider: 'google_drive' })] })]); wrap(<EvidenceDrawer tid="t" itemId="i1" onClose={() => {}} refresh={() => {}} />);
  const a = await screen.findByRole('link', { name: /Open link/ }); expect(a).toHaveAttribute('href', 'https://drive.google.com/x'); expect(a).toHaveAttribute('rel', 'noopener noreferrer'); expect(a).toHaveAttribute('target', '_blank');
});
test('a wrong file type is rejected in the browser before any upload', async () => {
  serve([request({ upload: true }, { versions: [], latestVersionNo: 0, status: 'requested' })]); wrap(<EvidenceDrawer tid="t" itemId="i1" onClose={() => {}} refresh={() => {}} />);
  const input = (await screen.findByLabelText('File')) as HTMLInputElement; fireEvent.change(input, { target: { files: [new File(['x'], 'run.exe')] } }); expect(await screen.findByRole('alert')).toHaveTextContent('.exe'); expect(screen.getByRole('button', { name: 'Upload file' })).toBeDisabled(); expect(apiUpload).not.toHaveBeenCalled();
});
test('the Evidence tab shows the summary, the storage bar and the bulk button only for managers on open engagements', async () => {
  (api as any).mockImplementation(async (_m: string, url: string) => url.includes('/evidence/config') ? CFG : { engagementId: 'e', summary: { total: 3, requested: 1, submitted: 1, accepted: 1, rejected: 0, cancelled: 0, expired: 1, overdue: 0 }, truncated: false, requests: [{ ...request({ review: true }), itemId: 'i1', itemRef: 'X-1', itemTitle: 'MFA', latest: { versionNo: 1, kind: 'file', fileName: 'policy.pdf', sizeBytes: 2048, uploadedByName: 'Vera', uploadedAt: '2026-10-01T10:00:00Z', scanStatus: 'clean' } }] });
  const d = (manage: boolean, status = 'active') => ({ status, permissions: { manage } }); const { unmount } = wrap(<EvidenceTab tid="t" eid="e" d={d(true)} refresh={() => {}} />);
  expect((await screen.findAllByText('Awaiting review')).length).toBeGreaterThan(0); expect(screen.getAllByText('Expired').length).toBeGreaterThan(0); expect(screen.getByRole('button', { name: 'Request evidence for items…' })).toBeInTheDocument(); expect(await screen.findByLabelText('Evidence storage')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument(); unmount();
  wrap(<EvidenceTab tid="t" eid="e" d={d(false)} refresh={() => {}} />); await screen.findByText('Security policy'); expect(screen.queryByRole('button', { name: 'Request evidence for items…' })).toBeNull();
});
