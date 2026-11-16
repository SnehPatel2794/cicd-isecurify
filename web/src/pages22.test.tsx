import { render, screen, waitFor, fireEvent } from '@testing-library/react'; import { QueryClient, QueryClientProvider } from '@tanstack/react-query'; import { MemoryRouter, Routes, Route } from 'react-router-dom'; import { vi } from 'vitest';
vi.mock('./api', () => ({ api: vi.fn(), ApiError: class extends Error {} })); vi.mock('./auth', () => ({ useAuth: vi.fn() }));
import { api } from './api'; import { useAuth } from './auth'; import { ContinuousPage } from './pages22'; import { chartPoints, pathOf, everyLabel, TREND_LABEL } from './continuousUi';
const wrap = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/org/o1/continuous']}><Routes><Route path="/org/:tid/continuous" element={<ContinuousPage />} /></Routes></MemoryRouter></QueryClientProvider>);
const as = (role: string, via = 'member') => (useAuth as any).mockReturnValue({ me: { user: { id: 'u1', name: 'Me' }, organizations: [{ id: 'o1', name: 'Acme', via, role }] } });
const TEST = { id: 't1', itemRef: 'C1', title: 'Restore a backup', engagementName: 'FY27', engagementStatus: 'active', frequency: 'monthly', responsibleName: 'Vera', nextDueOn: '2026-10-01', lastRunOn: null, state: 'overdue', status: 'active' };
const serve = (extra: Record<string, any> = {}) => (api as any).mockImplementation(async (m: string, p: string) => { for (const k of Object.keys(extra)) if (p.startsWith(k)) return extra[k]; if (p.includes('/posture')) return { tests: { total: 2, overdue: 1, failing: 0, dueSoon: 1 }, engagements: [{ id: 'e1', name: 'FY27', frameworks: [{ frameworkId: 'f1', name: 'ISO', color: '#812671', version: 1, current: { percent: 62.4, effective: 5, applicable: 8 }, series: [{ date: '2026-09-01', percent: 40 }, { date: '2026-10-29', percent: 62.4 }], change30: 22.4, trend: 'up' }] }] };
  if (p.includes('/control-tests') && m === 'GET') return { total: 1, tests: [TEST] }; if (p.includes('/evidence-schedules') && m === 'GET') return { total: 0, schedules: [] }; return { ok: true }; });
beforeEach(() => vi.clearAllMocks());
test('helpers: chart geometry stays inside the box, labels read well', () => {
  const p = chartPoints([{ date: '2026-01-01', percent: 0 }, { date: '2026-01-11', percent: 100 }], 100, 50, 4); expect(p[0]).toEqual({ x: 4, y: 46 }); expect(p[1]).toEqual({ x: 96, y: 4 }); expect(pathOf(p)).toBe('M4.0 46.0 L96.0 4.0'); expect(chartPoints([], 10, 10)).toEqual([]); expect(chartPoints([{ date: '2026-01-01', percent: 250 }], 100, 50)[0].y).toBe(4);
  expect(everyLabel(1)).toBe('every month'); expect(everyLabel(3)).toBe('every 3 months'); expect(everyLabel(12)).toBe('every year'); expect(everyLabel(24)).toBe('every 2 years'); expect(TREND_LABEL.up).toMatch(/improving/);
});
test('a client admin sees the posture per framework with the trend and the test health', async () => {
  as('client_admin'); serve(); wrap(); expect(await screen.findByText('62%')).toBeInTheDocument(); expect(screen.getByText(/improving/)).toBeInTheDocument(); expect(screen.getByText(/\+22.4 points in 30 days/)).toBeInTheDocument(); expect(screen.getByRole('img', { name: /Trend/ })).toBeInTheDocument(); expect(screen.getByText(/Recurring tests/)).toBeInTheDocument();
});
test('a vendor has no posture tab and lands on their tests; recording a failed result needs a note and warns who is told', async () => {
  as('third_party_vendor'); serve(); wrap(); expect(screen.queryByRole('tab', { name: 'Posture' })).toBeNull(); expect(await screen.findByText('Restore a backup')).toBeInTheDocument(); expect(screen.getByText('Overdue')).toBeInTheDocument(); expect(screen.queryByText('Add a recurring test')).toBeNull(); expect(screen.queryByText('Pause')).toBeNull();
  fireEvent.click(screen.getByText('Record result')); const save = await screen.findByText('Save result'); expect(save).toBeDisabled(); fireEvent.click(screen.getByLabelText('Failed')); expect(screen.getByText(/tells the client admins/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/What you did and found/), { target: { value: 'Checksum mismatch' } }); fireEvent.click(save);
  await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/t/o1/control-tests/t1/runs', { result: 'fail', note: 'Checksum mismatch', performedOn: undefined }));
});
test('a client admin can pause a test and open the add dialog; schedules show an empty state', async () => {
  as('client_admin'); serve(); wrap(); fireEvent.click(await screen.findByRole('tab', { name: 'Control tests' })); expect(await screen.findByText('Add a recurring test')).toBeInTheDocument(); fireEvent.click(screen.getByText('Pause')); await waitFor(() => expect(api).toHaveBeenCalledWith('PATCH', '/t/o1/control-tests/t1', { status: 'paused' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Evidence schedules' })); expect(await screen.findByText('No evidence refresh schedules yet.')).toBeInTheDocument();
});
test('"Request now" opens the request and says so', async () => {
  as('client_admin'); serve({ '/t/o1/evidence-schedules': { total: 1, schedules: [{ id: 's1', itemRef: 'C1', title: 'Access review', engagementName: 'FY27', engagementStatus: 'active', accountableName: 'Vera', everyMonths: 3, nextRunOn: '2026-10-01', lastOpenedOn: null, state: 'due', status: 'active' }] } });
  wrap(); fireEvent.click(await screen.findByRole('tab', { name: 'Evidence schedules' })); expect(await screen.findByText('Ready to request')).toBeInTheDocument(); fireEvent.click(screen.getByText('Request now')); await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/t/o1/evidence-schedules/s1/open')); expect(await screen.findByText('Requested: Access review')).toBeInTheDocument();
});
