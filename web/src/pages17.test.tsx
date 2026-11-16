import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { vi } from 'vitest';
vi.mock('./api', () => ({ api: vi.fn(), ApiError: class extends Error { constructor(public status: number, m: string) { super(m); } } }));
import { api } from './api'; import { VendorsPage } from './pages17'; import { byDomain, answeredCount, submitBlock, scoreText, dueText } from './vendorUi'; import { targetOf } from './notificationsUi';
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/org/t/vendors']}><Routes><Route path="/org/:tid/vendors" element={ui} /></Routes></MemoryRouter></QueryClientProvider>);
beforeEach(() => vi.clearAllMocks());
const QS = [{ id: 'a1', domain: 'Governance', text: 'Is there a policy?', weight: 3 }, { id: 'a2', domain: 'Governance', text: 'Is someone responsible?', weight: 2 }, { id: 'b1', domain: 'Access', text: 'Is MFA required?', weight: 3 }];
const V = (o: any = {}) => ({ id: 'v1', ref: 'V-001', name: 'Acme Hosting', service: 'Hosts the database', category: 'cloud', criticality: 'critical', dataAccess: 'personal', dataAccessLabel: 'Personal data', tier: 'critical', status: 'onboarding', statusLabel: 'Onboarding', ownerName: 'Dana', contactUserName: 'Pat', contactEmail: null, contractStart: null, contractEnd: null, reviewDate: null, reviewOverdue: false, latestScore: null, latestRating: null, openAssessment: null, approvedCount: 0, attention: ['No assessment has been requested yet'], can: { edit: true, transition: true, requestAssessment: true }, ...o });
const LIST = (vendors: any[], can = true) => ({ can: { create: can }, summary: { total: vendors.length, live: vendors.length, byTier: { critical: 1, high: 0, medium: 0, low: 0 }, overdue: 0, unassessed: 1, contractsEnding: 0 }, vendors });
const A = (o: any = {}) => ({ id: 'a-1', no: 1, status: 'draft', answers: {}, score: null, rating: null, domains: null, gaps: [], dueDate: null, reviewNote: null, can: { answer: true, submit: true, decide: false }, ...o });
const serve = (list: any, detail: any) => (api as any).mockImplementation(async (m: string, url: string) => m !== 'GET' ? { ok: true } : url.endsWith('/questionnaire') ? { version: 1, questions: QS } : url.includes('/members') ? [{ id: 'u1', name: 'Dana', status: 'active', role: 'client_admin' }] : /\/vendors\/v1$/.test(url) ? detail : list);

test('helpers: grouping, completeness, submit blockers, wording, notification link', () => {
  expect(byDomain(QS).map(g => [g.domain, g.questions.length])).toEqual([['Governance', 2], ['Access', 1]]); expect(answeredCount({ a1: { answer: 'yes' } }, QS)).toBe(1);
  expect(submitBlock({}, QS)).toBe('3 questions left to answer'); expect(submitBlock({ a1: { answer: 'yes' }, a2: { answer: 'yes' } }, QS)).toBe('1 question left to answer'); expect(submitBlock({ a1: { answer: 'yes' }, a2: { answer: 'yes' }, b1: { answer: 'na', note: ' ' } }, QS)).toBe('Explain each "not applicable" answer'); expect(submitBlock({ a1: { answer: 'yes' }, a2: { answer: 'yes' }, b1: { answer: 'na', note: 'cloud' } }, QS)).toBeNull();
  expect(scoreText(null, null)).toBe('Not scored yet'); expect(scoreText(82, 'good')).toBe('82/100 · good'); expect(dueText(null, '2026-10-27')).toBe(''); expect(dueText('2026-10-01', '2026-10-27')).toBe('Overdue since 2026-10-01'); expect(dueText('2026-11-01', '2026-10-27')).toBe('Due 2026-11-01');
  expect(targetOf({ tenantId: 't', entityType: 'vendor', entityId: 'v', engagementId: null })).toBe('/org/t/vendors');
});
test('register: summary, tier and status, attention hint for managers, add button and empty state', async () => {
  serve(LIST([V(), V({ id: 'v2', ref: 'V-002', name: 'Beta Ltd', tier: 'low', status: 'active', statusLabel: 'Active', latestScore: 88, reviewDate: '2027-01-01', attention: [] })]), null); wrap(<VendorsPage />);
  expect(await screen.findByLabelText('Summary')).toHaveTextContent('2 active · 1 critical'); expect(screen.getByText('Acme Hosting')).toBeInTheDocument(); expect(screen.getByText('No assessment has been requested yet')).toBeInTheDocument(); expect(screen.getByText('88')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Add a vendor' })).toBeInTheDocument();
});
test('register: a vendor user sees no add button and no hints', async () => {
  serve(LIST([V({ attention: ['x hint'] })], false), null); wrap(<VendorsPage />); await screen.findByText('Acme Hosting'); expect(screen.queryByRole('button', { name: 'Add a vendor' })).toBeNull(); expect(screen.queryByText('x hint')).toBeNull();
});
test('register: empty state', async () => { serve(LIST([]), null); wrap(<VendorsPage />); expect(await screen.findByText('No vendors yet.')).toBeInTheDocument(); });
test('adding a vendor sends the form', async () => {
  serve(LIST([]), null); wrap(<VendorsPage />); fireEvent.click(await screen.findByRole('button', { name: 'Add a vendor' })); const d = await screen.findByRole('dialog'); fireEvent.change(within(d).getByLabelText('Vendor name'), { target: { value: 'Gamma Co' } }); fireEvent.change(within(d).getByLabelText('What they do for us'), { target: { value: 'Payroll' } }); fireEvent.click(within(d).getByRole('button', { name: 'Add vendor' }));
  await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/t/t/vendors', expect.objectContaining({ name: 'Gamma Co', service: 'Payroll', category: 'cloud', criticality: 'medium', dataAccess: 'internal' })));
});
test('vendor screen: answering saves, Submit stays disabled until every question is answered', async () => {
  serve(LIST([V()]), { ...V(), events: [], assessments: [A()] }); wrap(<VendorsPage />); fireEvent.click(await screen.findByRole('button', { name: 'Acme Hosting' })); const d = await screen.findByRole('dialog'); const submit = await within(d).findByRole('button', { name: 'Submit for review' }); expect(submit).toBeDisabled(); expect(within(d).getByText('3 questions left to answer')).toBeInTheDocument();
  for (const q of QS) fireEvent.change(within(d).getByLabelText(q.text), { target: { value: 'yes' } }); expect(submit).not.toBeDisabled(); fireEvent.click(submit);
  await waitFor(() => expect(api).toHaveBeenCalledWith('PUT', '/t/t/vendors/v1/assessments/a-1/answers', { answers: { a1: { answer: 'yes', note: '' }, a2: { answer: 'yes', note: '' }, b1: { answer: 'yes', note: '' } } })); await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/t/t/vendors/v1/assessments/a-1/submit'));
});
test('vendor screen: a reviewer sees score, gaps and decisions; sending back needs a note', async () => {
  const sub = A({ status: 'submitted', answers: { a1: { answer: 'no', note: 'Planned' }, a2: { answer: 'yes' }, b1: { answer: 'yes' } }, score: 62, rating: 'fair', domains: [{ domain: 'Governance', score: 40 }], gaps: [{ id: 'a1', domain: 'Governance', text: 'Is there a policy?', answer: 'no', weight: 3, severity: 'high' }], can: { answer: false, submit: false, decide: true } });
  serve(LIST([V()]), { ...V({ openAssessment: 'submitted' }), events: [{ id: 'e1', kind: 'created', actorName: 'Dana', createdAt: '2026-10-20T00:00:00Z' }], assessments: [sub] }); wrap(<VendorsPage />); fireEvent.click(await screen.findByRole('button', { name: 'Acme Hosting' })); const d = await screen.findByRole('dialog');
  expect(await within(d).findByText('62/100 · fair')).toBeInTheDocument(); expect(within(d).getByText(/Is there a policy\?/)).toBeInTheDocument(); const back = within(d).getByRole('button', { name: 'Send back' }); expect(back).toBeDisabled(); fireEvent.change(within(d).getByLabelText("Reviewer's note"), { target: { value: 'Add the policy' } }); expect(back).not.toBeDisabled(); fireEvent.click(back);
  await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/t/t/vendors/v1/assessments/a-1/decision', { action: 'return', note: 'Add the policy' }));
});
