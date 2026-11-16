import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
vi.mock('./api', () => ({ api: vi.fn(), ApiError: class extends Error {} })); vi.mock('./auth', () => ({ useAuth: vi.fn() }));
import { api } from './api'; import { useAuth } from './auth'; import { SearchPage, MyWorkPage, TimelinePage, SearchBox } from './pages20'; import { toQuery, fromParams, activeCount, statusLabel, shortDate } from './spogUi';
const Loc = () => { const l = useLocation(); return <div data-testid="loc">{l.pathname + l.search}</div>; };
const wrap = (path: string, ui: React.ReactNode, route: string) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={<>{ui}<Loc /></>} /></Routes></MemoryRouter></QueryClientProvider>);
beforeEach(() => { vi.clearAllMocks(); (useAuth as any).mockReturnValue({ me: { user: { id: 'u1', name: 'Me' }, organizations: [{ id: 'o1', name: 'Acme', via: 'member', role: 'client_admin' }, { id: 'o2', name: 'Beta', via: 'member', role: 'client_staff' }] } }); });
const ENGS = [{ id: 'e1', name: 'Annual audit', frameworks: [{ frameworkId: 'f1', name: 'ISO 27001' }] }];
const serve = (map: Record<string, any>) => (api as any).mockImplementation(async (_m: string, path: string) => { for (const k of Object.keys(map)) if (path.startsWith(k)) return map[k]; throw new Error('unexpected ' + path); });

test('helpers: query strings keep only set filters, parse back, count, label and date', () => {
expect(toQuery({ orgId: 'o', status: '' as any, from: '2026-01-01' }, { q: 'a b', type: undefined })).toBe('orgId=o&from=2026-01-01&q=a+b'); expect(fromParams(new URLSearchParams('orgId=o&junk=1&to=2026-02-02'))).toEqual({ orgId: 'o', to: '2026-02-02' });
  expect(activeCount({ orgId: 'o', status: 'x' })).toBe(2); expect(statusLabel('ready_for_retest')).toBe('Ready for re-test'); expect(statusLabel('open')).toBe('Open'); expect(statusLabel(null)).toBe(''); expect(shortDate('2026-10-05')).toBe('5 Oct 2026'); expect(shortDate(null)).toBe('');
});
test('the header search box goes to the search page, and ignores a single character', async () => {
  wrap('/', <SearchBox />, '*'); const box = screen.getByLabelText('Global search'); fireEvent.change(box, { target: { value: 'a' } }); fireEvent.submit(box.closest('form')!); expect(screen.getByTestId('loc').textContent).toBe('/');
  fireEvent.change(box, { target: { value: 'quokka & co' } }); fireEvent.submit(box.closest('form')!); await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/search?q=quokka%20%26%20co'));
});
test('search results are grouped by type with status, place and snippet; a "more" note appears when cut off', async () => {
  serve({ '/me/search': { q: 'quokka', groups: [{ type: 'finding', more: true, results: [{ type: 'finding', id: 'f1', ref: 'F-001', title: 'Quokka weak password', snippet: '…guessed by a quokka…', status: 'in_remediation', owner: 'Sam', engagementName: 'Annual audit', orgName: 'Acme', path: '/org/o1/findings?focus=f1' }] }, { type: 'policy', more: false, results: [{ type: 'policy', id: 'p1', ref: 'POL-001', title: 'Quokka policy', snippet: null, status: 'published', owner: null, engagementName: null, orgName: 'Beta', path: '/org/o2/policies?focus=p1' }] }] }, '/t/': ENGS });
  wrap('/search?q=quokka', <SearchPage />, '/search'); const fin = await screen.findByLabelText('Findings'); expect(within(fin).getByRole('link', { name: 'F-001 · Quokka weak password' })).toHaveAttribute('href', '/org/o1/findings?focus=f1'); expect(within(fin).getByText('In remediation')).toBeInTheDocument(); expect(within(fin).getByText(/guessed by a quokka/)).toBeInTheDocument(); expect(within(fin).getByText(/showing the best 1/)).toBeInTheDocument();
  expect(within(screen.getByLabelText('Policies')).getByText(/Beta/)).toBeInTheDocument(); expect(api).toHaveBeenCalledWith('GET', '/me/search?q=quokka');
});
test('search: empty result, too-short text and failure each say so; choosing a client reloads with that filter', async () => {
  serve({ '/me/search': { q: 'zzz', groups: [] } }); wrap('/search?q=zzz', <SearchPage />, '/search'); expect(await screen.findByText(/Nothing found for “zzz”/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'o2' } }); await waitFor(() => expect(api).toHaveBeenCalledWith('GET', '/me/search?orgId=o2&q=zzz'));
  (api as any).mockReset(); wrap('/search?q=a', <SearchPage />, '/search'); expect((await screen.findAllByText(/at least 2 characters/)).length).toBeGreaterThan(0); expect(api).not.toHaveBeenCalledWith('GET', expect.stringContaining('/me/search?q=a'));
});
test('search failure shows an error', async () => { (api as any).mockRejectedValue(new Error('x')); wrap('/search?q=abc', <SearchPage />, '/search'); expect(await screen.findByRole('alert')).toBeInTheDocument(); });
test('My Work lists sections per organization with overdue marks, and offers engagement/framework filters once one client is chosen', async () => {
  serve({ '/me/work': { today: '2026-10-29', total: 2, organizations: [{ id: 'o1', name: 'Acme', total: 2, sections: [{ key: 'items', title: 'Checklist items assigned to me', kind: 'item', more: false, entries: [{ id: 'i1', ref: 'A.5.1', title: 'Access review', status: 'needs_work', dueDate: '2026-10-01', overdue: true, engagementName: 'Annual audit', path: '/org/o1/engagements/e1?item=i1' }] }, { key: 'review_evidence', title: 'Evidence waiting for my review', kind: 'review', more: true, entries: [{ id: 'r1', ref: 'A.5.2', title: 'Policy PDF', status: 'submitted', dueDate: null, overdue: false, engagementName: 'Annual audit', path: '/org/o1/engagements/e1?item=i2' }] }] }] }, '/t/': ENGS });
  wrap('/my-work', <MyWorkPage />, '/my-work'); expect(await screen.findByText('2 things need you')).toBeInTheDocument(); const it = screen.getByLabelText('Checklist items assigned to me'); expect(within(it).getByRole('link', { name: 'A.5.1 · Access review' })).toHaveAttribute('href', '/org/o1/engagements/e1?item=i1'); expect(within(it).getByText(/Overdue · 1 Oct 2026/)).toBeInTheDocument(); expect(within(screen.getByLabelText('Evidence waiting for my review')).getByText('1+')).toBeInTheDocument();
  expect(screen.queryByLabelText('Engagement')).toBeNull(); fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'o1' } }); expect(await screen.findByLabelText('Engagement')).toBeInTheDocument(); expect(screen.getByLabelText('Framework')).toBeInTheDocument(); await waitFor(() => expect(api).toHaveBeenCalledWith('GET', '/me/work?orgId=o1'));
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } }); await waitFor(() => expect(api).toHaveBeenCalledWith('GET', '/me/work?orgId=o1&from=2026-10-01')); fireEvent.click(screen.getByRole('button', { name: 'Clear filters' })); await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/my-work'));
});
test('My Work: nothing waiting, and an error, are both stated', async () => {
  serve({ '/me/work': { today: 'x', total: 0, organizations: [] } }); wrap('/my-work', <MyWorkPage />, '/my-work'); expect(await screen.findByText('Nothing is waiting for you.')).toBeInTheDocument();
  (api as any).mockReset(); (api as any).mockRejectedValue(new Error('x')); wrap('/my-work', <MyWorkPage />, '/my-work'); expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
});
test('activity timeline: events with actor and link, "only mine" for administrators, and Show older loads the next page', async () => {
  let n = 0; (api as any).mockImplementation(async (_m: string, path: string) => { if (path.startsWith('/t/o1/engagements')) return ENGS; if (path.includes('beforeId=5')) return { scope: 'organization', items: [{ id: 4, at: '2026-10-27T08:00:00Z', actor: null, action: 'x.y', label: 'X y', entity: 'user', entityId: 'u', engagementId: null, path: null }], nextBeforeId: null }; n++; return { scope: 'organization', items: [{ id: 6, at: '2026-10-28T09:00:00Z', actor: { id: 'u1', name: 'Asha' }, action: 'engagement.created', label: 'Engagement created', entity: 'engagement', entityId: 'e1', engagementId: 'e1', path: '/org/o1/engagements/e1' }], nextBeforeId: 5 }; });
  wrap('/org/o1/timeline', <TimelinePage />, '/org/:tid/timeline'); const list = await screen.findByLabelText('Activity timeline'); expect(within(list).getByText('Engagement created')).toBeInTheDocument(); expect(within(list).getByText('Asha')).toBeInTheDocument(); expect(within(list).getByRole('link', { name: 'Open engagement' })).toHaveAttribute('href', '/org/o1/engagements/e1'); expect(screen.getByText('Everything in this organization')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show older' })); await waitFor(() => expect(within(screen.getByLabelText('Activity timeline')).getByText('System')).toBeInTheDocument()); expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull();
  fireEvent.click(screen.getByLabelText('Only mine')); await waitFor(() => expect(api).toHaveBeenCalledWith('GET', '/t/o1/timeline?ownerId=u1&limit=30')); expect(n).toBeGreaterThan(1);
});
test('activity timeline for a person who sees only their own: no owner filter is offered', async () => {
  (api as any).mockImplementation(async (_m: string, path: string) => path.startsWith('/t/o2/engagements') ? [] : { scope: 'mine', items: [], nextBeforeId: null }); wrap('/org/o2/timeline', <TimelinePage />, '/org/:tid/timeline'); expect(await screen.findByText('Your own activity')).toBeInTheDocument(); expect(screen.queryByLabelText('Only mine')).toBeNull(); expect(screen.getByText('No activity for these filters.')).toBeInTheDocument();
});
