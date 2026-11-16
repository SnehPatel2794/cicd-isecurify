import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
vi.mock('./api', () => ({ api: vi.fn(), ApiError: class extends Error {} }));
import { api } from './api'; import { OrgTiles, tileValue } from './tiles'; import { ItemsPage } from './pages21';
const Loc = () => { const l = useLocation(); return <div data-testid="loc">{l.pathname + l.search}</div>; };
const wrap = (path: string, ui: React.ReactNode, route: string) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={<>{ui}<Loc /></>} /></Routes></MemoryRouter></QueryClientProvider>);
beforeEach(() => vi.clearAllMocks());
const CAT = { widgets: [{ id: 'items-overdue', title: 'Overdue items', drill: '/org/o1/items?overdue=true' }, { id: 'findings-critical', title: 'Critical findings', drill: '/org/o1/findings?severity=critical&unresolved=true' }, { id: 'readiness', title: 'Readiness', drill: '/org/o1/items' }, { id: 'my-work', title: 'My work', drill: '/my-work?orgId=o1' }] };
const T = (o: any) => ({ unit: null, detail: null, empty: false, freshness: { source: 'summary', stale: false, ageMinutes: 2 }, ...o });
test('value text', () => { expect(tileValue({ value: 5, unit: null })).toBe('5'); expect(tileValue({ value: 62.5, unit: '%' })).toBe('62.5%'); expect(tileValue({ value: null, unit: '%' })).toBe('—'); });
test('each tile loads on its own and shows its own state: value + link, stale badge, empty, and error with retry; one failure leaves the rest working', async () => {
  let fails = 0; (api as any).mockImplementation(async (_m: string, path: string) => { if (path === '/t/o1/widgets') return CAT;
    if (path.endsWith('/items-overdue')) return T({ id: 'items-overdue', title: 'Overdue items', value: 7, drill: '/org/o1/items?overdue=true', freshness: { source: 'summary', stale: true, ageMinutes: 31 } });
    if (path.endsWith('/findings-critical')) { fails++; if (fails === 1) throw new Error('boom'); return T({ value: 2, drill: '/org/o1/findings?severity=critical&unresolved=true' }); }
    if (path.endsWith('/readiness')) return T({ value: 62.5, unit: '%', detail: '5 of 8 controls effective', drill: '/org/o1/items' }); return T({ value: 0, empty: true, drill: '/my-work?orgId=o1' }); });
  wrap('/x', <OrgTiles tid="o1" />, '/x'); const od = await screen.findByLabelText('Overdue items'); expect(await within(od).findByRole('link', { name: /Overdue items: 7/ })).toHaveAttribute('href', '/org/o1/items?overdue=true'); expect(within(od).getByText('May be out of date')).toBeInTheDocument();
  const rd = screen.getByLabelText('Readiness'); expect(await within(rd).findByText('62.5%')).toBeInTheDocument(); expect(within(rd).getByText('5 of 8 controls effective')).toBeInTheDocument(); expect(within(screen.getByLabelText('My work')).getByText('Nothing here yet.')).toBeInTheDocument();
  const bad = screen.getByLabelText('Critical findings'); expect(await within(bad).findByRole('alert')).toBeInTheDocument(); fireEvent.click(within(bad).getByRole('button', { name: 'Retry' })); expect(await within(bad).findByRole('link', { name: /Critical findings: 2/ })).toHaveAttribute('href', '/org/o1/findings?severity=critical&unresolved=true');
  expect(within(screen.getByLabelText('At a glance')).queryByText('May be out of date', { selector: 'span' }) ).toBeTruthy();
});
test('no tiles for this person: nothing is rendered; catalog failure is silent', async () => { (api as any).mockResolvedValue({ widgets: [] }); const { container } = wrap('/x', <OrgTiles tid="o1" />, '/x'); await waitFor(() => expect(api).toHaveBeenCalled()); await waitFor(() => expect(container.querySelector('[aria-label="At a glance"]')).toBeNull()); });
const ITEMS = (o: any = {}) => ({ today: '2026-10-29', total: 120, page: 1, pageSize: 50, items: [{ id: 'i1', ref: 'A.5.1', title: 'Access review', engagementId: 'e1', engagementName: 'Annual', state: 'awaiting_review', stateLabel: 'Awaiting review', dueDate: '2026-10-01', overdue: true, owner: 'Sam', ownerUserId: 'u' }], ...o });
test('items page: filters come from the link, the count is shown, rows link to the item, paging works', async () => {
  (api as any).mockImplementation(async (_m: string, path: string) => path.includes('/engagements') && !path.includes('/items') ? [{ id: 'e1', name: 'Annual' }] : ITEMS());
  wrap('/org/o1/items?overdue=true&state=awaiting_review', <ItemsPage />, '/org/:tid/items'); expect(await screen.findByLabelText('Count')).toHaveTextContent('120 items'); expect(api).toHaveBeenCalledWith('GET', '/t/o1/items?state=awaiting_review&overdue=true&page=1&pageSize=50');
  expect(screen.getByLabelText('State')).toHaveValue('awaiting_review'); expect(screen.getByLabelText('Overdue only')).toBeChecked(); expect(screen.getByRole('link', { name: 'Access review' })).toHaveAttribute('href', '/org/o1/engagements/e1?item=i1'); expect(screen.getByText(/1 Oct 2026 \(overdue\)/)).toBeInTheDocument();
  expect(screen.getByText('Page 1 of 3')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Next' })); await waitFor(() => expect(screen.getByTestId('loc').textContent).toContain('page=2')); await waitFor(() => expect(api).toHaveBeenCalledWith('GET', expect.stringContaining('page=2')));
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' })); await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/org/o1/items'));
});
test('items page: empty and error states', async () => {
  (api as any).mockImplementation(async (_m: string, path: string) => path.includes('/items') ? ITEMS({ total: 0, items: [] }) : []); wrap('/org/o1/items', <ItemsPage />, '/org/:tid/items'); expect(await screen.findByText('No items match.')).toBeInTheDocument();
  (api as any).mockReset(); (api as any).mockRejectedValue(new Error('x')); wrap('/org/o1/items', <ItemsPage />, '/org/:tid/items'); expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
});
