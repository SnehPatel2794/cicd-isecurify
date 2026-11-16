import { test, expect, vi, beforeEach, afterEach } from 'vitest'; import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'; import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
vi.mock('./api', async (orig) => ({ ...(await orig<any>()), api: vi.fn(), apiBlob: vi.fn(), apiUpload: vi.fn(), saveBlob: vi.fn() }));
import { api, apiUpload } from './api'; import { TasksTab, TaskTemplatesAdmin, filterTasks, taskNo } from './pages26';
const wrap = (ui: any) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
beforeEach(() => { (api as any).mockReset(); (apiUpload as any).mockReset(); }); afterEach(cleanup);
const T = (n: number, o: any = {}) => ({ id: `t${n}`, taskNo: n, title: `Task ${n}`, status: 'not_started', statusLabel: 'Not started', priority: 'normal', assigneeId: null, assigneeName: null, ownerHint: null, dueDate: null, overdue: false, waitingOn: 0, commentCount: 0, depIds: [], ...o });
const list = (over: any = {}, can: any = {}, tasks = [T(1, { assigneeId: 'me', assigneeName: 'Me', status: 'in_progress', statusLabel: 'In progress', dueDate: '2026-01-01', overdue: true }), T(2, { ownerHint: 'IT head', waitingOn: 1 }), T(3, { status: 'done', statusLabel: 'Done' })]) => ({ engagementId: 'e', engagementStatus: 'active', scope: 'all', tasks, counts: { total: 3, overdue: 1, byStatus: { in_progress: 1, not_started: 1, done: 1 } }, can: { manage: true, plan: true, ...can },
  statuses: ['not_started', 'in_progress', 'waiting', 'blocked', 'done', 'cancelled'].map(s => ({ status: s, label: s.replace('_', ' ') })), phases: [], ...over });

test('filtering by status, mine, overdue and text; numbering', () => {
  const ts = [T(1, { assigneeId: 'me', overdue: true }), T(2, { title: 'Collect NDAs', ownerHint: 'Lead' }), T(3, { status: 'done' })]; const none = { status: '', mine: false, overdue: false, q: '' };
  expect(filterTasks(ts, none, 'me')).toHaveLength(3); expect(filterTasks(ts, { ...none, mine: true }, 'me').map(t => t.id)).toEqual(['t1']); expect(filterTasks(ts, { ...none, overdue: true }, 'me')).toHaveLength(1); expect(filterTasks(ts, { ...none, status: 'done' }, 'me')).toHaveLength(1);
  expect(filterTasks(ts, { ...none, q: 'nda' }, 'me')).toHaveLength(1); expect(filterTasks(ts, { ...none, q: 'T-003' }, 'me')).toHaveLength(1); expect(taskNo(7)).toBe('T-007');
});
test('a manager sees counts, the list, waiting-on and overdue markers, and can switch to the board', async () => {
  (api as any).mockImplementation(async () => list()); wrap(<TasksTab tid="t" eid="e" me="me" />);
  expect(await screen.findByText(/3 tasks · 1 done/)).toBeTruthy(); expect(screen.getByText(/1 overdue/)).toBeTruthy(); expect(screen.getByText('waiting on 1')).toBeTruthy(); expect(screen.getByText('(IT head)')).toBeTruthy(); expect(screen.getByRole('button', { name: 'New task' })).toBeTruthy(); expect(screen.getByRole('button', { name: 'Import plan or template' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Board' })); expect(screen.getAllByLabelText(/column$/)).toHaveLength(5);
});
test('someone who only sees their own tasks cannot create or import, and changes status in one step', async () => {
  (api as any).mockImplementation(async (m: string) => m === 'GET' ? list({ scope: 'mine' }, { manage: false, plan: false }, [T(1, { assigneeId: 'me', assigneeName: 'Me' }), T(2, { assigneeId: 'other', assigneeName: 'Other' })]) : { ok: true });
  wrap(<TasksTab tid="t" eid="e" me="me" />); expect(await screen.findByText(/assigned to you/)).toBeTruthy(); expect(screen.queryByRole('button', { name: 'New task' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Import plan or template' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull();
  expect(screen.queryByLabelText('Status of T-002')).toBeNull(); fireEvent.change(screen.getByLabelText('Status of T-001'), { target: { value: 'done' } });
  await waitFor(() => expect(api).toHaveBeenCalledWith('PATCH', '/t/t/tasks/t1', { status: 'done' }));
});
test('a closed engagement shows statuses read-only', async () => {
  (api as any).mockImplementation(async () => list({ engagementStatus: 'closed' }, { manage: false, plan: false })); wrap(<TasksTab tid="t" eid="e" me="me" />); await screen.findByText(/3 tasks/); expect(screen.queryByLabelText('Status of T-001')).toBeNull(); expect(screen.queryByRole('button', { name: 'New task' })).toBeNull();
});
test('the plan dialog previews a file, blocks loading while rows have errors, and loads a clean plan', async () => {
  const prevOk = { counts: { total: 2, valid: 2, invalid: 0 }, rows: [{ row: 2, ref: 'A', title: 'Kick-off', start: '2026-11-16', due: '2026-11-16', errors: [] }, { row: 3, ref: 'B', title: 'Answers', start: '2026-11-17', due: '2026-11-23', errors: [] }] };
  (api as any).mockImplementation(async (m: string, u: string) => u.endsWith('/task-templates') ? [{ id: 'tp', name: 'ISO plan', itemCount: 40 }] : list());
  (apiUpload as any).mockImplementation(async (u: string) => u.includes('confirm=true') ? { confirmed: true, created: 2 } : prevOk);
  wrap(<TasksTab tid="t" eid="e" me="me" />); fireEvent.click(await screen.findByRole('button', { name: 'Import plan or template' })); expect(await screen.findByText(/ISO plan \(40 tasks\)/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Plan file'), { target: { files: [new File(['x'], 'plan.csv')] } }); expect(await screen.findByText(/2 of 2 tasks are valid/)).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Load 2 tasks' }));
  await waitFor(() => expect(apiUpload).toHaveBeenCalledWith(expect.stringContaining('/tasks/import?confirm=true&startDate='), expect.anything()));
  cleanup(); (apiUpload as any).mockImplementation(async () => ({ counts: { total: 1, valid: 0, invalid: 1 }, rows: [{ row: 2, ref: 'A', title: 'x', start: null, due: null, errors: ['bad days'] }] }));
  wrap(<TasksTab tid="t" eid="e" me="me" />); fireEvent.click(await screen.findByRole('button', { name: 'Import plan or template' })); fireEvent.change(await screen.findByLabelText('Plan file'), { target: { files: [new File(['x'], 'plan.csv')] } }); expect(await screen.findByText(/bad days/)).toBeTruthy(); expect((screen.getByRole('button', { name: 'Load 0 tasks' }) as HTMLButtonElement).disabled).toBe(true);
});
test('platform administrators upload a task template; others only see the list', async () => {
  (api as any).mockImplementation(async () => [{ id: 'x', name: 'ISO plan', frameworkName: null, itemCount: 40 }]); (apiUpload as any).mockImplementation(async (u: string) => u.includes('confirm') ? { confirmed: true } : { counts: { total: 3, valid: 3, invalid: 0 }, rows: [] });
  wrap(<TaskTemplatesAdmin admin frameworks={[{ id: 'f', name: 'ISO 27001' }]} />); expect(await screen.findByText('ISO plan')).toBeTruthy(); fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'My plan' } }); fireEvent.change(screen.getByLabelText('Task plan file'), { target: { files: [new File(['x'], 'p.csv')] } });
  expect(await screen.findByText(/3 of 3 tasks are valid/)).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Save template' })); await waitFor(() => expect(apiUpload).toHaveBeenCalledWith(expect.stringContaining('confirm=true&name=My%20plan'), expect.anything()));
  cleanup(); wrap(<TaskTemplatesAdmin admin={false} frameworks={[]} />); await screen.findByText('ISO plan'); expect(screen.queryByLabelText('Task plan file')).toBeNull(); expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
});
