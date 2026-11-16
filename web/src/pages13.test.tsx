import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
vi.mock('./api', () => ({ api: vi.fn(), ApiError: class extends Error { constructor(public status: number, m: string) { super(m); } } }));
vi.mock('./auth', () => ({ useAuth: vi.fn() }));
import { api } from './api'; import { useAuth } from './auth'; import { MappingApprovalsPage, ProcessAdminPage } from './pages13'; import { MappingRequestForm } from './pages3'; import { parsePaths, toRows, buildBody, groupQuestions } from './processUi';
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
const as = (role: string, id = 'u1') => (useAuth as any).mockReturnValue({ me: { user: { id, platformRole: role } } });
const REQ = (o: any = {}) => ({ id: 'r1', controlRef: 'P-1', controlTitle: 'One', frameworkName: 'FW', frameworkVersion: 1, kind: 'set', commonControlTitle: 'Backups', rationale: 'Aligns', status: 'pending', requestedById: 'u9', requestedBy: 'Dana', requestedAt: '2026-10-20T10:00:00Z', ...o });
beforeEach(() => vi.clearAllMocks());

test('pure helpers: path parsing, template rows, request bodies, question grouping', () => {
  expect(parsePaths('TYPE1_ONLY,BOGUS, TYPE2_ONLY')).toEqual(['TYPE1_ONLY', 'TYPE2_ONLY']); expect(parsePaths(null)).toEqual([]);
  expect(toRows([{ phase: 2, title: 'b', sortOrder: 1 }, { phase: 1, title: 'a', pathFilter: 'TYPE1_ONLY', sortOrder: 2 }, { phase: 1, title: 'a0', sortOrder: 1 }])).toEqual([{ phase: 1, title: 'a0', paths: [] }, { phase: 1, title: 'a', paths: ['TYPE1_ONLY'] }, { phase: 2, title: 'b', paths: [] }]);
  expect(buildBody(' ', [{ phase: 1, title: 'x', paths: [] }])).toEqual({ ok: false, message: 'Give the template a name' }); expect(buildBody('n', [])).toMatchObject({ ok: false }); expect((buildBody('n', [{ phase: 1, title: ' ', paths: [] }]) as any).message).toBe('Milestone 1 has no title');
  expect(buildBody(' N ', [{ phase: 2, title: ' B ', paths: ['TYPE2_ONLY'] }, { phase: 1, title: 'A', paths: [] }])).toEqual({ ok: true, body: { name: 'N', milestones: [{ phase: 1, title: 'A' }, { phase: 2, title: 'B', pathFilter: ['TYPE2_ONLY'] }] } });
  const g = groupQuestions([{ frameworkName: 'Zed', active: 1 }, { frameworkName: null, active: 1 }, { frameworkName: 'Abc', active: 0 }], false); expect(g.map(x => x[0])).toEqual(['All engagements', 'Zed']); expect(groupQuestions([{ frameworkName: 'Abc', active: 0 }], true).length).toBe(1);
});
test('approvals: the requester can only withdraw; another administrator approves, and rejecting needs a note', async () => {
  as('admin', 'u9'); (api as any).mockResolvedValue({ enabled: true, requests: [REQ()] }); const r = wrap(<MappingApprovalsPage />); expect(await screen.findByText(/Your request: a second administrator must decide it/)).toBeInTheDocument(); expect(screen.queryByText('Approve')).toBeNull(); fireEvent.click(screen.getByText('Withdraw')); await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/mapping-requests/r1/withdraw', { note: undefined })); r.unmount();
  vi.clearAllMocks(); as('admin', 'u2'); (api as any).mockResolvedValue({ enabled: true, requests: [REQ()] }); wrap(<MappingApprovalsPage />); const reject = await screen.findByText('Reject'); expect(reject).toBeDisabled(); fireEvent.change(screen.getByLabelText('Note for P-1'), { target: { value: 'Not needed' } }); expect(reject).toBeEnabled(); fireEvent.click(screen.getByText('Approve')); await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/mapping-requests/r1/approve', { note: 'Not needed' }));
});
test('approvals: only a Super Admin can change the policy; the list can be filtered; decided requests show who decided', async () => {
  as('admin'); (api as any).mockResolvedValue({ enabled: true, requests: [REQ({ status: 'approved', decidedBy: 'Lee', decisionNote: 'fine' })] }); const r = wrap(<MappingApprovalsPage />); expect(await screen.findByRole('checkbox')).toBeDisabled(); expect(await screen.findByText(/Decided by Lee: fine/)).toBeInTheDocument(); fireEvent.click(screen.getByRole('tab', { name: 'Approved' })); await waitFor(() => expect(api).toHaveBeenCalledWith('GET', '/mapping-requests?status=approved')); r.unmount();
  as('super_admin'); (api as any).mockResolvedValue({ enabled: false, requests: [] }); wrap(<MappingApprovalsPage />); const box = await screen.findByRole('checkbox'); expect(box).toBeEnabled(); fireEvent.click(box); await waitFor(() => expect(api).toHaveBeenCalledWith('PUT', '/platform/settings/mapping-approval', { enabled: true })); expect(await screen.findByText(/No pending requests/)).toBeInTheDocument();
});
test('request form: sends the control, the target and the reason; confirms', async () => {
  (api as any).mockResolvedValue({ id: 'n' }); const done = vi.fn(); wrap(<MappingRequestForm control={{ id: 'c1', ref: 'P-1' }} commonControlId="cc9" commonTitle="Backups" onDone={done} />); fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Better fit' } }); fireEvent.click(screen.getByText('Submit for approval'));
  await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/controls/c1/mapping-requests', { commonControlId: 'cc9', rationale: 'Better fit' })); expect(await screen.findByText(/Request submitted/)).toBeInTheDocument();
});
const TEMPLATES = [{ id: 't1', name: 'Generic', frameworkId: null, milestones: [{ phase: 1, sortOrder: 1, title: 'Kick-off', pathFilter: null }, { phase: 2, sortOrder: 1, title: 'Collect', pathFilter: 'TYPE2_ONLY' }] }]; const FWS = [{ id: 'f1', name: 'SOC 2' }];
const QS = [{ id: 'q1', frameworkId: null, frameworkName: null, domain: 'Scope', question: 'Which systems are in scope?', active: 1 }, { id: 'q2', frameworkId: 'f1', frameworkName: 'SOC 2', domain: 'Audit', question: 'Old question', active: 0 }];
const load = () => (api as any).mockImplementation(async (m: string, url: string) => m !== 'GET' ? { ok: true } : url === '/process-templates' ? TEMPLATES : url === '/discovery-questions' ? QS : FWS);
test('templates: shows the generic template by phase, edits and saves exactly what changed', async () => {
  as('admin'); load(); wrap(<ProcessAdminPage />); const p1 = await screen.findByLabelText('Phase 1'); expect(within(p1).getByDisplayValue('Kick-off')).toBeInTheDocument(); expect(within(screen.getByLabelText('Phase 2')).getByLabelText('Type II only')).toBeChecked();
  fireEvent.click(within(p1).getByText('Add milestone to phase 1')); const inputs = within(p1).getAllByLabelText(/Milestone \d+ title/); fireEvent.change(inputs[inputs.length - 1], { target: { value: 'Sign NDA' } }); fireEvent.click(screen.getByText('Save template'));
  await waitFor(() => expect(api).toHaveBeenCalledWith('PUT', '/process-templates/default', { name: 'Generic', milestones: [{ phase: 1, title: 'Kick-off' }, { phase: 1, title: 'Sign NDA' }, { phase: 2, title: 'Collect', pathFilter: ['TYPE2_ONLY'] }] })); expect(await screen.findByText(/Template saved/)).toBeInTheDocument();
});
test('templates: an empty title is caught before sending; a framework without a template starts empty; read-only for non-administrators', async () => {
  as('admin'); load(); const r = wrap(<ProcessAdminPage />); const p1 = await screen.findByLabelText('Phase 1'); fireEvent.click(within(p1).getByText('Add milestone to phase 1')); fireEvent.click(screen.getByText('Save template')); expect(await screen.findByText('Milestone 3 has no title')).toBeInTheDocument(); expect((api as any).mock.calls.some((c: any[]) => c[0] === 'PUT')).toBe(false);
  fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'f1' } }); expect(screen.queryByDisplayValue('Kick-off')).toBeNull(); expect(screen.getByDisplayValue('SOC 2 engagement')).toBeInTheDocument(); r.unmount();
  as('isecurify_team'); wrap(<ProcessAdminPage />); expect(await screen.findByText(/Only administrators can change them/)).toBeInTheDocument(); expect(screen.queryByText('Save template')).toBeNull(); expect(screen.getByDisplayValue('Kick-off')).toBeDisabled();
});
test('questions: grouped, retired hidden until asked, add / edit / retire send the right requests', async () => {
  as('admin'); load(); wrap(<ProcessAdminPage />); fireEvent.click(await screen.findByRole('tab', { name: 'Discovery questions' })); expect(screen.getByText('Which systems are in scope?')).toBeInTheDocument(); expect(screen.queryByText('Old question')).toBeNull(); fireEvent.click(screen.getByLabelText('Show retired questions')); expect(screen.getByText('Old question')).toBeInTheDocument();
  const form = screen.getByLabelText('Add question'); fireEvent.change(within(form).getByLabelText('Applies to'), { target: { value: 'f1' } }); fireEvent.change(within(form).getByLabelText('Domain'), { target: { value: 'Data' } }); fireEvent.change(within(form).getByLabelText('Question'), { target: { value: 'Where is data stored?' } }); fireEvent.click(within(form).getByText('Add question'));
  await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/discovery-questions', { frameworkId: 'f1', domain: 'Data', question: 'Where is data stored?' }));
  fireEvent.click(screen.getByLabelText('Retire Which systems are in scope?')); await waitFor(() => expect(api).toHaveBeenCalledWith('PATCH', '/discovery-questions/q1', { active: false })); fireEvent.click(screen.getByLabelText('Restore Old question')); await waitFor(() => expect(api).toHaveBeenCalledWith('PATCH', '/discovery-questions/q2', { active: true }));
  fireEvent.click(screen.getAllByText('Edit')[0]); fireEvent.change(screen.getByLabelText('Edit question'), { target: { value: 'Which systems?' } }); fireEvent.click(screen.getByText('Save')); await waitFor(() => expect(api).toHaveBeenCalledWith('PATCH', '/discovery-questions/q1', { domain: 'Scope', question: 'Which systems?' }));
});
