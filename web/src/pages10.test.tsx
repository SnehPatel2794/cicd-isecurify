import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { vi } from 'vitest';
vi.mock('./api', () => ({ api: vi.fn(), apiBlob: vi.fn(), saveBlob: vi.fn(), ApiError: class extends Error {} }));
import { api, apiBlob, saveBlob } from './api'; import { CertificatesPage, VerifyPage } from './pages10'; import { statusTone, statusText, readyText, addDays, verifyCodeOf } from './certUi'; import { targetOf, headline } from './notificationsUi';
const wrap = (path: string, ui: React.ReactNode, route: string) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={ui} /></Routes></MemoryRouter></QueryClientProvider>);
const C = (o: any = {}) => ({ id: 'c1', number: 'ISG-2026-000001', frameworkName: 'ISO 27001', frameworkVersion: '2022', engagementName: 'Annual audit', issuedOn: '2026-10-01', validUntil: '2027-10-01', status: 'valid', statusLabel: 'Valid', expiringSoon: false, daysLeft: 340, overridden: false, ...o });
const list = (can: boolean, certs: any[]) => ({ can: { issue: can, revoke: can }, summary: { valid: 1, expiringSoon: 0, expired: 0, revoked: 0, superseded: 0 }, certificates: certs });
beforeEach(() => vi.clearAllMocks());

test('pure helpers: tones, wording, readiness text, dates, codes, notification links', () => {
  expect(statusTone('valid', false)).toBe('green'); expect(statusTone('valid', true)).toBe('amber'); expect(statusTone('revoked', false)).toBe('red'); expect(statusTone('superseded', false)).toBe('slate');
  expect(statusText({ status: 'valid', expiringSoon: true, daysLeft: 1 })).toBe('Valid · expires in 1 day'); expect(statusText({ status: 'expired', statusLabel: 'Expired' })).toBe('Expired');
  expect(readyText({ applicable: 4, effective: 4, ready: true })).toMatch(/All 4/); expect(readyText({ applicable: 4, effective: 1, ready: false })).toBe('1 of 4 applicable controls effective'); expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  expect(verifyCodeOf('A'.repeat(22))).not.toBeNull(); expect(verifyCodeOf('short')).toBeNull();
  expect(targetOf({ tenantId: 't', entityType: 'certificate', entityId: 'c', engagementId: null })).toBe('/org/t/certificates'); expect(headline({ kind: 'certificate.revoked', actorName: 'Priya' })).toBe('Priya revoked a certificate');
});
test('client admins see certificates and can download, but cannot issue or revoke', async () => {
  (api as any).mockResolvedValue(list(false, [C()])); (apiBlob as any).mockResolvedValue(new Blob(['x'])); wrap('/org/t/certificates', <CertificatesPage />, '/org/:tid/certificates');
  expect(await screen.findByText('ISG-2026-000001')).toBeInTheDocument(); expect(screen.queryByText('Issue certificate')).toBeNull(); expect(screen.queryByLabelText('Revoke ISG-2026-000001')).toBeNull();
  fireEvent.click(screen.getByLabelText('Download ISG-2026-000001')); await waitFor(() => expect(saveBlob).toHaveBeenCalledWith(expect.anything(), 'ISG-2026-000001.pdf')); expect(apiBlob).toHaveBeenCalledWith('/t/t/certificates/c1/pdf');
});
test('revoked certificates cannot be downloaded; overrides are flagged', async () => {
  (api as any).mockResolvedValue(list(true, [C({ status: 'revoked', statusLabel: 'Revoked' }), C({ id: 'c2', number: 'ISG-2026-000002', overridden: true, overrideReason: 'board' })])); wrap('/org/t/certificates', <CertificatesPage />, '/org/:tid/certificates');
  await screen.findByText('ISG-2026-000002'); expect(screen.queryByLabelText('Download ISG-2026-000001')).toBeNull(); expect(screen.getByLabelText('Download ISG-2026-000002')).toBeInTheDocument(); expect(screen.getByText('Issued with override')).toBeInTheDocument();
});
test('issuing: not-ready options require a reason, and the request carries the chosen engagement and framework', async () => {
  const opts = [{ engagementId: 'e1', frameworkId: 'f1', engagementName: 'Audit', frameworkName: 'ISO', frameworkVersion: '1', applicable: 3, effective: 1, ready: false }];
  (api as any).mockImplementation(async (m: string, url: string) => m === 'POST' ? { id: 'n' } : url.endsWith('/eligible') ? { options: opts } : list(true, []));
  wrap('/org/t/certificates', <CertificatesPage />, '/org/:tid/certificates'); fireEvent.click(await screen.findByText('Issue certificate'));
  fireEvent.change(await screen.findByLabelText(/Engagement and framework/), { target: { value: 'e1|f1' } }); fireEvent.change(screen.getByLabelText('Scope of the certificate'), { target: { value: 'Data centre operations' } }); fireEvent.change(await screen.findByLabelText(/Reason for issuing/), { target: { value: 'Board accepted the risk' } });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Issue certificate' })); await waitFor(() => expect((api as any).mock.calls.some((c: any[]) => c[0] === 'POST' && c[2].engagementId === 'e1' && c[2].frameworkId === 'f1' && c[2].overrideReason === 'Board accepted the risk')).toBe(true));
});
test('revoking asks for a reason and posts it', async () => {
  (api as any).mockImplementation(async (m: string) => m === 'POST' ? {} : list(true, [C()])); wrap('/org/t/certificates', <CertificatesPage />, '/org/:tid/certificates'); fireEvent.click(await screen.findByLabelText('Revoke ISG-2026-000001'));
  fireEvent.change(await screen.findByLabelText('Reason'), { target: { value: 'Scope misstated' } }); fireEvent.click(screen.getByRole('button', { name: 'Revoke certificate' })); await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/t/t/certificates/c1/revoke', { reason: 'Scope misstated' }));
});
test('public verify page: valid, revoked and unknown codes', async () => {
  const code = 'A'.repeat(22); const P = { valid: true, status: 'valid', number: 'ISG-2026-000001', organization: 'Org A', framework: 'ISO (version 1)', scope: 'Scope', issuedOn: '2026-10-01', validUntil: '2027-10-01', issuer: 'iSecurify' };
  (api as any).mockResolvedValue(P); const r = wrap(`/verify/${code}`, <VerifyPage />, '/verify/:code'); expect(await screen.findByText('This certificate is valid')).toBeInTheDocument(); expect(screen.getByText('Org A')).toBeInTheDocument(); r.unmount();
  (api as any).mockResolvedValue({ ...P, valid: false, status: 'revoked' }); const r2 = wrap(`/verify/${code}`, <VerifyPage />, '/verify/:code'); expect(await screen.findByText('This certificate is revoked')).toBeInTheDocument(); r2.unmount();
  (api as any).mockRejectedValue(new Error('404')); wrap(`/verify/${code}`, <VerifyPage />, '/verify/:code'); expect(await screen.findByText('Certificate not found')).toBeInTheDocument();
});
test('malformed code shows not found without calling the server', async () => { wrap('/verify/short', <VerifyPage />, '/verify/:code'); expect(await screen.findByText('Certificate not found')).toBeInTheDocument(); expect(api).not.toHaveBeenCalled(); });
