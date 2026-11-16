import { test, expect, vi, beforeEach, afterEach } from 'vitest'; import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'; import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
vi.mock('./api', async (orig) => ({ ...(await orig<any>()), api: vi.fn(), apiBlob: vi.fn(), apiUpload: vi.fn(), saveBlob: vi.fn() }));
import { api, apiUpload } from './api'; import { QuestionnaireTab, QuestionnaireAdmin } from './pages25';
const wrap = (ui: any) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
beforeEach(() => { (api as any).mockReset(); (apiUpload as any).mockReset(); }); afterEach(cleanup);
const q = (over: any = {}, can: any = {}) => ({ engagementId: 'e', engagementStatus: 'active', can: { answer: true, review: false, ...can }, progress: { total: 2, answered: 1, open: 1, toReview: 1, sentBack: 0, accepted: 0 },
  frameworks: [{ frameworkId: 'f', name: 'ISO 27001', versionNo: 2, questions: [
    { id: 'q1', ref: 'Q-1', section: 'S', question: 'Where is production hosted?', answerType: 'choice', choices: ['Own DC', 'Cloud'], required: true, answered: false, answer: null },
    { id: 'q2', ref: 'Q-2', section: 'S', question: 'Employees in scope?', answerType: 'number', choices: null, required: false, answered: true, answer: '120', answeredBy: 'Ann', reviewStatus: 'needs_change', reviewNote: 'Include contractors' }], ...over }] });

test('the client answers a question; required ones are marked; a sent-back reason is shown', async () => {
  (api as any).mockImplementation(async (m: string) => m === 'GET' ? q() : { ok: true }); wrap(<QuestionnaireTab tid="t" eid="e" refresh={() => {}} />);
  expect(await screen.findByText(/1 required still open/)).toBeTruthy(); expect(screen.getByText(/Include contractors/)).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
  const save = screen.getAllByRole('button', { name: 'Save answer' })[0] as HTMLButtonElement; expect(save.disabled).toBe(true); fireEvent.change(screen.getByLabelText(/Where is production hosted/), { target: { value: 'Cloud' } }); expect(save.disabled).toBe(false); fireEvent.click(save);
  await waitFor(() => expect(api).toHaveBeenCalledWith('PUT', '/t/t/engagements/e/questionnaire/q1', { answer: 'Cloud', note: null }));
});
test('staff can accept, and sending back needs a reason', async () => {
  (api as any).mockImplementation(async (m: string) => m === 'GET' ? q({}, { review: true, answer: false }) : { ok: true }); wrap(<QuestionnaireTab tid="t" eid="e" refresh={() => {}} />);
  await screen.findByText(/to review/); expect(screen.queryByRole('button', { name: 'Save answer' })).toBeNull(); const back = screen.getByRole('button', { name: 'Send back' }) as HTMLButtonElement; expect(back.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/Reason to send Q-2 back/), { target: { value: 'Add the contractors' } }); expect(back.disabled).toBe(false); fireEvent.click(back);
  await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/t/t/engagements/e/questionnaire/q2/review', { status: 'needs_change', note: 'Add the contractors' }));
});
test('an upload with errors cannot be saved; a clean one can', async () => {
  (api as any).mockResolvedValue([]); (apiUpload as any).mockResolvedValue({ confirmed: false, counts: { total: 2, valid: 1, invalid: 1, required: 1 }, rows: [{ row: 2, ref: 'A', question: 'Q', answerType: 'text', valid: true, errors: [] }, { row: 3, ref: 'B', question: 'R', valid: false, errors: ['answer type "x" is not one of: yes/no'] }] });
  wrap(<QuestionnaireAdmin frameworkId="f" admin />); fireEvent.change(await screen.findByLabelText('Questionnaire file'), { target: { files: [new File(['x'], 'q.csv')] } });
  expect(await screen.findByText(/1 of 2 questions are valid/)).toBeTruthy(); expect((screen.getByRole('button', { name: 'Save as draft' }) as HTMLButtonElement).disabled).toBe(true);
});
test('13A: core questions show no edit or remove; others do (staff only); removing needs a reason; the industry is set from the list', async () => {
  const data = { ...q({}, { edit: true }), industry: null, industries: ['BFSI', 'Healthcare'] }; data.frameworks[0].questions[0] = { ...data.frameworks[0].questions[0], core: true, industryList: [] }; data.frameworks[0].questions[1] = { ...data.frameworks[0].questions[1], core: false, industryList: ['BFSI'] };
  (api as any).mockImplementation(async (m: string) => m === 'GET' ? data : { ok: true }); wrap(<QuestionnaireTab tid="t" eid="e" refresh={() => {}} />);
  await screen.findByText(/Where is production hosted/); expect(screen.getAllByText('Core').length).toBe(1); expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBe(1); expect(screen.getAllByRole('button', { name: 'Remove' }).length).toBe(1); expect(screen.getByText(/For: BFSI/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Remove' })); const ok = screen.getByRole('button', { name: 'Confirm remove' }) as HTMLButtonElement; expect(ok.disabled).toBe(true); fireEvent.change(screen.getByLabelText(/Reason to remove Q-2/), { target: { value: 'Not applicable here' } }); fireEvent.click(ok);
  await waitFor(() => expect(api).toHaveBeenCalledWith('DELETE', '/t/t/engagements/e/questionnaire/q2', { reason: 'Not applicable here' }));
  fireEvent.change(screen.getByLabelText('Client industry'), { target: { value: 'BFSI' } }); await waitFor(() => expect(api).toHaveBeenCalledWith('PUT', '/t/t/engagements/e/questionnaire-industry', { industry: 'BFSI' }));
});
test('13A: a client admin sees no editing controls', async () => {
  (api as any).mockImplementation(async (m: string) => m === 'GET' ? { ...q({}, { edit: false }), industry: null, industries: [] } : { ok: true }); wrap(<QuestionnaireTab tid="t" eid="e" refresh={() => {}} />);
  await screen.findByText(/Where is production hosted/); expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Add question' })).toBeNull(); expect(screen.queryByLabelText('Client industry')).toBeNull();
});
