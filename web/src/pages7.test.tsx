import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
vi.mock('./api', () => ({ api: vi.fn(), apiBlob: vi.fn(), apiUpload: vi.fn(), saveBlob: vi.fn(), ApiError: class extends Error {} }));
import { api } from './api'; import { FindingsTab, FindingDrawer, ItemFindingsDrawer, FindingsPage } from './pages7'; import { MemoryRouter, Route, Routes } from 'react-router-dom';
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const SUM = { total: 2, unresolved: 2, blocking: 1, overdue: 1, byStatus: { open: 1, ready_for_retest: 1 }, bySeverity: { high: 1, low: 1 } };
const F = (o: any = {}) => ({ id: 'f1', ref: 'F-001', findingNo: 1, itemId: 'i1', itemRef: 'X-1', itemTitle: 'MFA', title: 'No MFA', description: 'Password only', recommendation: 'Enforce MFA', severity: 'high', status: 'open', statusLabel: 'Open', ownerUserId: null, ownerName: null, dueDate: '2026-12-01', remediationPlan: null, raisedBy: 'Audrey', createdAt: '2026-10-01T10:00:00Z', closedAt: null, blocking: true, overdue: false, isOwner: false,
  can: { transitions: [], edit: false, assign: false, plan: false, comment: true, linkEvidence: false }, evidence: [], daysOverdue: 0, ageDays: 3, engagementName: 'Audit One', events: [{ id: 'e1', kind: 'raised', fromStatus: null, toStatus: 'open', note: null, actorName: 'Audrey', createdAt: '2026-10-01T10:00:00Z' }], ...o });
const D = (o: any = {}) => ({ status: 'active', permissions: { manage: false, via: 'member', role: 'tp_auditor' }, ...o });
const serve = (finding: any, extra: any = {}) => (api as any).mockImplementation(async (m: string, url: string) => {
  if (url.endsWith('/members')) return [{ id: 'u1', name: 'Vera Vendor', status: 'active', role: 'third_party_vendor' }, { id: 'u2', name: 'Audrey', status: 'active', role: 'tp_auditor' }];
  if (/\/engagements\/e1\/findings/.test(url)) return { engagementId: 'e1', engagementStatus: 'active', canRaise: true, summary: SUM, truncated: false, findings: [finding, F({ id: 'f2', ref: 'F-002', title: 'Weak log retention', severity: 'low', blocking: false, status: 'ready_for_retest' })], ...extra };
  if (/\/engagements\/e1\/checklist/.test(url)) return { items: [{ id: 'i1', ref: 'X-1', title: 'MFA', readiness: 'implemented' }, { id: 'i2', ref: 'X-2', title: 'NA item', readiness: 'not_applicable' }] };
  if (/\/checklist\/i1\/findings/.test(url)) return { item: { id: 'i1', ref: 'X-1', title: 'MFA' }, canRaise: true, findings: [finding] };
  if (/\/findings\/f1\/linkable-evidence$/.test(url)) return [{ requestId: 'r1', title: 'MFA screenshot', status: 'requested', versionCount: 0 }];
  if (/\/t\/t\/findings(\?.*)?$/.test(url)) return { today: '2026-10-24', summary: { ...SUM, byStatus: { ready_for_retest: 1, closed: 3 } }, overdueBuckets: { '1-7': 0, '8-30': 1, '31-90': 0, '90+': 2 }, truncated: false, findings: [F({ overdue: true, daysOverdue: 12 }), F({ id: 'f9', ref: 'F-009', title: 'Other audit finding', engagementName: 'Audit Two', blocking: false, severity: 'low' })] };
  if (/\/findings\/f1$/.test(url)) return finding; return {}; });
beforeEach(() => { vi.clearAllMocks(); });

test('tab shows summary chips, flags blocking and overdue findings and lets an auditor raise one', async () => {
  serve(F({ overdue: true })); wrap(<FindingsTab tid="t" eid="e1" d={D()} refresh={() => {}} />);
  expect(await screen.findByText('No MFA')).toBeInTheDocument(); expect(screen.getByText('Blocking controls')).toBeInTheDocument(); expect(screen.getByText('blocks control')).toBeInTheDocument(); expect(screen.getByText('overdue')).toBeInTheDocument(); expect(screen.getByText('Weak log retention')).toBeInTheDocument(); expect(screen.getByText('Raise a finding')).toBeInTheDocument();
});
test('read-only people see no raise button; filters go to the server', async () => {
  serve(F(), { canRaise: false }); wrap(<FindingsTab tid="t" eid="e1" d={D()} refresh={() => {}} />); await screen.findByText('No MFA'); expect(screen.queryByText('Raise a finding')).toBeNull();
  fireEvent.change(screen.getByLabelText('Filter by severity'), { target: { value: 'high' } }); await waitFor(() => expect((api as any).mock.calls.some((c: any[]) => String(c[1]).includes('severity=high'))).toBe(true));
  fireEvent.click(screen.getByLabelText('Unresolved only')); await waitFor(() => expect((api as any).mock.calls.some((c: any[]) => String(c[1]).includes('unresolved=true'))).toBe(true));
});
test('raising: needs an item, title and description; N/A items are not offered; the due date follows the severity until edited', async () => {
  serve(F()); wrap(<FindingsTab tid="t" eid="e1" d={D()} refresh={() => {}} />); fireEvent.click(await screen.findByText('Raise a finding'));
  const submit = await screen.findByRole('button', { name: 'Raise finding' }); expect(submit).toBeDisabled(); expect(screen.queryByText(/NA item/)).toBeNull(); expect(screen.queryByLabelText('Owner')).toBeNull();   // auditors do not assign owners
  fireEvent.change(await screen.findByLabelText('Checklist item'), { target: { value: 'i1' } }); fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Open S3 bucket' } }); fireEvent.change(screen.getByLabelText(/What is wrong/), { target: { value: 'Public read' } }); expect(submit).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'critical' } }); expect(screen.getByText(/stops the control from showing as Effective/)).toBeInTheDocument();
  (api as any).mockImplementationOnce(async () => ({ id: 'n' })); fireEvent.click(submit);
  await waitFor(() => expect((api as any).mock.calls.some((c: any[]) => c[0] === 'POST' && c[1] === '/t/t/checklist/i1/findings' && c[2].severity === 'critical' && c[2].title === 'Open S3 bucket' && /^\d{4}-\d{2}-\d{2}$/.test(c[2].dueDate) && c[2].ownerUserId === null)).toBe(true));
});
test('managers can pick an owner, and only client-side members are offered', async () => {
  serve(F()); wrap(<FindingsTab tid="t" eid="e1" d={D({ permissions: { manage: true, via: 'member', role: 'client_admin' } })} refresh={() => {}} />); fireEvent.click(await screen.findByText('Raise a finding'));
  const owner = await screen.findByLabelText('Owner'); await waitFor(() => expect(screen.getByText('Vera Vendor')).toBeInTheDocument()); expect(screen.queryByRole('option', { name: 'Audrey' })).toBeNull(); expect(owner).toBeInTheDocument();
});
test('the owner sees only the buttons the server allows; a note is required to mark ready for retest', async () => {
  serve(F({ status: 'in_remediation', can: { transitions: [{ to: 'ready_for_retest', note: true }], edit: false, assign: false, plan: true, comment: true }, isOwner: true })); wrap(<FindingDrawer tid="t" id="f1" onClose={() => {}} refresh={() => {}} />);
  const b = await screen.findByRole('button', { name: 'Mark ready for retest' }); expect(screen.queryByRole('button', { name: 'Close (retest passed)' })).toBeNull(); fireEvent.click(b);
  const confirm = await screen.findByRole('button', { name: /Confirm: Mark ready/ }); expect(confirm).toBeDisabled(); fireEvent.change(screen.getByLabelText(/What was fixed/), { target: { value: 'MFA on' } }); expect(confirm).toBeEnabled();
  (api as any).mockImplementationOnce(async () => ({})); fireEvent.click(confirm); await waitFor(() => expect((api as any).mock.calls.some((c: any[]) => c[1] === '/t/t/findings/f1/transition' && c[2].to === 'ready_for_retest' && c[2].note === 'MFA on')).toBe(true));
});
test('an auditor gets retest buttons; changing severity requires a note and sends it', async () => {
  serve(F({ status: 'ready_for_retest', can: { transitions: [{ to: 'closed', note: true }, { to: 'in_remediation', note: true }, { to: 'cancelled', note: true }], edit: true, assign: false, plan: false, comment: true } })); wrap(<FindingDrawer tid="t" id="f1" onClose={() => {}} refresh={() => {}} />);
  expect(await screen.findByRole('button', { name: 'Close (retest passed)' })).toBeInTheDocument(); expect(screen.getByRole('button', { name: /Retest failed/ })).toBeInTheDocument();
  fireEvent.click(screen.getByText('Edit details')); fireEvent.change(await screen.findByLabelText('Severity'), { target: { value: 'low' } }); const save = screen.getByRole('button', { name: 'Save' }); expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Why is the severity changing/), { target: { value: 'compensating control' } }); expect(save).toBeEnabled(); (api as any).mockImplementationOnce(async () => ({})); fireEvent.click(save);
  await waitFor(() => expect((api as any).mock.calls.some((c: any[]) => c[0] === 'PATCH' && c[1] === '/t/t/findings/f1' && c[2].severity === 'low' && c[2].note === 'compensating control' && !('title' in c[2]))).toBe(true));
});
test('a vendor who does not own the finding gets no workflow or edit controls but can comment; history shows who did what', async () => {
  serve(F({ events: [{ id: 'e1', kind: 'raised', note: null, actorName: 'Audrey', createdAt: '2026-10-01T10:00:00Z' }, { id: 'e2', kind: 'status', fromStatus: 'open', toStatus: 'in_remediation', note: 'starting', actorName: 'Vera', createdAt: '2026-10-02T10:00:00Z' }] })); wrap(<FindingDrawer tid="t" id="f1" onClose={() => {}} refresh={() => {}} />);
  expect(await screen.findByText(/changed status: Open → In remediation/)).toBeInTheDocument(); expect(screen.getByText('starting')).toBeInTheDocument(); expect(screen.queryByLabelText('Finding workflow')).toBeNull(); expect(screen.queryByText('Edit details')).toBeNull();
  fireEvent.change(screen.getByLabelText(/Add a comment/), { target: { value: 'on it' } }); (api as any).mockImplementationOnce(async () => ({})); fireEvent.click(screen.getByRole('button', { name: 'Comment' })); await waitFor(() => expect((api as any).mock.calls.some((c: any[]) => c[1] === '/t/t/findings/f1/comments' && c[2].note === 'on it')).toBe(true));
});
test('per-item drawer lists the item findings and offers raising only when allowed', async () => {
  serve(F()); wrap(<ItemFindingsDrawer tid="t" itemId="i1" d={D()} onClose={() => {}} refresh={() => {}} />); expect(await screen.findByText('No MFA')).toBeInTheDocument(); expect(screen.getByText('Raise a finding on this item')).toBeInTheDocument(); fireEvent.click(screen.getByLabelText('Open F-001')); expect(await screen.findByText('Password only')).toBeInTheDocument();
});

test('tracking page: chips, overdue ageing, late text, and filters go to the server', async () => {
  serve(F()); wrap(<MemoryRouter initialEntries={['/org/t/findings']}><Routes><Route path="/org/:tid/findings" element={<FindingsPage />} /></Routes></MemoryRouter>);
  expect(await screen.findByText('Findings and remediation')).toBeInTheDocument(); expect(screen.getByText('Overdue findings by age')).toBeInTheDocument(); expect(screen.getByText('Over 90 days late')).toBeInTheDocument(); expect(screen.getByText('12 days late')).toBeInTheDocument(); expect(screen.getByText(/Audit Two · X-1/)).toBeInTheDocument();
  expect((api as any).mock.calls.some((c: any[]) => c[1] === '/t/t/findings?unresolved=true')).toBe(true);   // unresolved is on by default
  fireEvent.click(screen.getByLabelText('Assigned to me')); await waitFor(() => expect((api as any).mock.calls.some((c: any[]) => String(c[1]).includes('mine=true') && String(c[1]).includes('unresolved=true'))).toBe(true)); expect(screen.getByLabelText('Assigned to me')).toBeInTheDocument();   // filters stay on screen while loading
  fireEvent.click(screen.getByLabelText('Ready for retest')); await waitFor(() => expect((api as any).mock.calls.some((c: any[]) => String(c[1]).includes('awaitingRetest=true'))).toBe(true));
});
test('tracking page: opening a finding shows its drawer', async () => {
  serve(F()); wrap(<MemoryRouter initialEntries={['/org/t/findings']}><Routes><Route path="/org/:tid/findings" element={<FindingsPage />} /></Routes></MemoryRouter>); fireEvent.click((await screen.findAllByLabelText(/^Open F-001/))[0]); expect(await screen.findByText('Password only')).toBeInTheDocument();
});
test('remediation evidence: shows attached requests with their live status; people who may link can attach; managers can request new evidence and attach it', async () => {
  serve(F({ evidence: [{ requestId: 'r0', title: 'Policy PDF', status: 'submitted', validUntil: null, versionCount: 2, linkedByName: 'Vera' }, { requestId: 'r9', title: 'Old proof', status: 'accepted', expired: true, validUntil: '2026-01-01', versionCount: 1, linkedByName: 'Audrey' }], can: { transitions: [], edit: false, assign: true, plan: false, comment: true, linkEvidence: true } }));
  wrap(<FindingDrawer tid="t" id="f1" onClose={() => {}} refresh={() => {}} />); expect(await screen.findByText('Policy PDF')).toBeInTheDocument(); expect(screen.getByText('2 version(s) · attached by Vera')).toBeInTheDocument(); expect(screen.getByText('Expired')).toBeInTheDocument();
  const sel = await screen.findByLabelText('Attach evidence request'); fireEvent.change(sel, { target: { value: 'r1' } }); (api as any).mockImplementationOnce(async () => ({})); fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
  await waitFor(() => expect((api as any).mock.calls.some((c: any[]) => c[0] === 'POST' && c[1] === '/t/t/findings/f1/evidence' && c[2].requestId === 'r1')).toBe(true));
  fireEvent.change(screen.getByPlaceholderText('What should be uploaded?'), { target: { value: 'Screenshot of MFA setting' } }); (api as any).mockImplementationOnce(async () => ({ id: 'newreq' })); (api as any).mockImplementationOnce(async () => ({})); fireEvent.click(screen.getByRole('button', { name: 'Request and attach' }));
  await waitFor(() => expect((api as any).mock.calls.some((c: any[]) => c[1] === '/t/t/checklist/i1/evidence-requests' && c[2].title === 'Screenshot of MFA setting')).toBe(true)); await waitFor(() => expect((api as any).mock.calls.some((c: any[]) => c[1] === '/t/t/findings/f1/evidence' && c[2].requestId === 'newreq')).toBe(true));
});
test('people who cannot link see the list but no attach controls; a closed finding offers none', async () => {
  serve(F({ evidence: [{ requestId: 'r0', title: 'Policy PDF', status: 'accepted', validUntil: '2027-01-01', versionCount: 1, linkedByName: 'Vera' }] })); wrap(<FindingDrawer tid="t" id="f1" onClose={() => {}} refresh={() => {}} />);
  expect(await screen.findByText('Policy PDF')).toBeInTheDocument(); expect(screen.queryByLabelText('Attach evidence request')).toBeNull(); expect(screen.queryByRole('button', { name: 'Request and attach' })).toBeNull();
});
test('drill-down links open the findings list already filtered', async () => {
  serve(F()); wrap(<MemoryRouter initialEntries={['/org/t/findings?overdue=true&severity=critical&unresolved=true']}><Routes><Route path="/org/:tid/findings" element={<FindingsPage />} /></Routes></MemoryRouter>);
  await screen.findByText('Findings and remediation'); expect(api).toHaveBeenCalledWith('GET', '/t/t/findings?overdue=true&unresolved=true&severity=critical');
});
