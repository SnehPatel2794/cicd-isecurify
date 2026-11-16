import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
vi.mock('./api', () => ({ api: vi.fn(), ApiError: class extends Error {} }));
vi.mock('./auth', () => ({ useAuth: vi.fn() }));
import { api } from './api'; import { useAuth } from './auth'; import { NotificationBell, NotificationsPage } from './notifications';
const Where = () => { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div>; };
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/start']}><Routes><Route path="*" element={<>{ui}<Where /></>} /></Routes></MemoryRouter></QueryClientProvider>);
const N = (id: number, o: any = {}) => ({ id, tenantId: 't1', tenantName: 'Acme', kind: 'finding.assigned', entityType: 'finding', entityId: '11111111-1111-1111-1111-111111111111', engagementId: 'g1', label: `F-00${id} Weak passwords`, createdAt: new Date().toISOString(), read: false, actorName: 'Priya', kindLabel: 'x', ...o });
let unread = 2; let items: any[];
beforeEach(() => { vi.clearAllMocks(); unread = 2; items = [N(2), N(1, { read: true, kind: 'evidence.accepted', entityType: 'evidence_request', label: 'A.5.1: Policy' })];
  (useAuth as any).mockReturnValue({ me: { user: { platformRole: 'none' }, organizations: [{ id: 't1', name: 'Acme', via: 'member' }, { id: 't2', name: 'Beta', via: 'member' }] } });
  (api as any).mockImplementation(async (m: string, url: string, body: any) => {
    if (url === '/me/notifications/count') return { unread };
    if (url.startsWith('/me/notifications/read')) { if (body.all) { unread = 0; items = items.map(i => ({ ...i, read: true })); } else { unread = Math.max(0, unread - 1); } return { marked: 1 }; }
    if (url.startsWith('/me/notifications')) return { unread, unreadByTenant: { t1: 2 }, nextBefore: url.includes('before=') ? null : (url.includes('limit=30') ? 1 : null), notifications: url.includes('before=') ? [N(0, { label: 'Older one', read: true })] : items };
    if (url === '/me/notification-prefs' && m === 'GET') return { kinds: [{ kind: 'finding.assigned', group: 'Findings', label: 'A finding is assigned to me', inApp: true, email: true }, { kind: 'finding.comment', group: 'Findings', label: 'Someone comments on a finding I own or raised', inApp: false }] };
    if (url === '/me/email-digest' && m === 'GET') return { frequency: 'daily', lastSentAt: new Date(Date.now() - 3600_000 * 5).toISOString() };
    return { ok: true };
  }); });

test('the bell shows the unread count, hides it when zero, and caps it at 99+', async () => {
  const { unmount } = wrap(<NotificationBell />); expect(await screen.findByLabelText('Notifications, 2 unread')).toBeInTheDocument(); expect(screen.getByTestId('unread-badge')).toHaveTextContent('2'); unmount();
  unread = 250; wrap(<NotificationBell />); expect(await screen.findByTestId('unread-badge')).toHaveTextContent('99+');
});
test('no badge when everything is read', async () => { unread = 0; wrap(<NotificationBell />); await screen.findByLabelText('Notifications'); await waitFor(() => expect(api).toHaveBeenCalled()); expect(screen.queryByTestId('unread-badge')).toBeNull(); });
test('opening the panel lists notifications; clicking one marks it read and goes to the finding', async () => {
  wrap(<NotificationBell />); fireEvent.click(await screen.findByLabelText('Notifications, 2 unread')); const dlg = await screen.findByRole('dialog', { name: 'Notifications' });
  expect(await within(dlg).findByText('Priya assigned you a finding')).toBeInTheDocument(); expect(within(dlg).getByText('F-002 Weak passwords')).toBeInTheDocument(); expect(within(dlg).getByText('A.5.1: Policy')).toBeInTheDocument();
  fireEvent.click(within(dlg).getByText('F-002 Weak passwords')); await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/me/notifications/read', { ids: [2] }));
  expect(screen.getByTestId('where')).toHaveTextContent('/org/t1/findings?open=11111111-1111-1111-1111-111111111111'); expect(screen.queryByRole('dialog')).toBeNull();
});
test('an already-read notification still opens its target but is not marked again; evidence leads to the Evidence tab', async () => {
  wrap(<NotificationBell />); fireEvent.click(await screen.findByLabelText('Notifications, 2 unread')); fireEvent.click(await screen.findByText('A.5.1: Policy'));
  expect(screen.getByTestId('where')).toHaveTextContent('/org/t1/engagements/g1?tab=Evidence'); expect(api).not.toHaveBeenCalledWith('POST', '/me/notifications/read', expect.anything());
});
test('mark all read, Escape closes, and an empty list says so', async () => {
  wrap(<NotificationBell />); fireEvent.click(await screen.findByLabelText('Notifications, 2 unread')); await screen.findByText('Priya assigned you a finding'); fireEvent.click(screen.getByText('Mark all read')); await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/me/notifications/read', { all: true }));
  fireEvent.keyDown(document, { key: 'Escape' }); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  items = []; fireEvent.click(screen.getByLabelText(/Notifications/)); expect(await screen.findByText('You are all caught up.')).toBeInTheDocument();
});
test('the page filters by unread and organization, loads older items, and offers the settings', async () => {
  wrap(<NotificationsPage />); expect(await screen.findByText('Notifications')).toBeInTheDocument(); expect(await screen.findByText('F-002 Weak passwords')).toBeInTheDocument(); expect(screen.getByText('2 unread')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Unread only')); await waitFor(() => expect(api).toHaveBeenCalledWith('GET', '/me/notifications?limit=30&unread=true'));
  fireEvent.change(screen.getByLabelText('Organization'), { target: { value: 't1' } }); await waitFor(() => expect(api).toHaveBeenCalledWith('GET', '/me/notifications?limit=30&unread=true&tenantId=t1'));
  fireEvent.click(await screen.findByText('Load older')); expect(await screen.findByText('Older one')).toBeInTheDocument(); expect(api).toHaveBeenCalledWith('GET', expect.stringContaining('&before=1'));
});
test('settings: every kind has a switch, and changing one saves it', async () => {
  wrap(<NotificationsPage />); const box = await screen.findByLabelText('A finding is assigned to me'); expect(box).toBeChecked(); expect(screen.getByLabelText('Someone comments on a finding I own or raised')).not.toBeChecked();
  fireEvent.click(box); await waitFor(() => expect(api).toHaveBeenCalledWith('PUT', '/me/notification-prefs', { kind: 'finding.assigned', inApp: false }));
});
test('a single organization hides the organization filter', async () => { (useAuth as any).mockReturnValue({ me: { user: { platformRole: 'none' }, organizations: [{ id: 't1', name: 'Acme', via: 'member' }] } }); wrap(<NotificationsPage />); await screen.findByText('F-002 Weak passwords'); expect(screen.queryByLabelText('Organization')).toBeNull(); });
test('email digest: shows the current frequency and when it was last sent, and saves a change', async () => {
  wrap(<NotificationsPage />); const sel = await screen.findByLabelText('Digest frequency'); expect(sel).toHaveValue('daily'); expect(screen.getByText(/Last sent 5 h ago/)).toBeInTheDocument();
  fireEvent.change(sel, { target: { value: 'weekly' } }); await waitFor(() => expect(api).toHaveBeenCalledWith('PUT', '/me/email-digest', { frequency: 'weekly' }));
});
test('reminders read as Due soon / Overdue with the stored description', async () => {
  items = [N(5, { kind: 'reminder.overdue', actorName: null, entityType: 'evidence_request', label: 'A.1: Policy — overdue by 3 days (was due 2026-10-21)' })]; wrap(<NotificationsPage />);
  expect(await screen.findByText('Overdue')).toBeInTheDocument(); expect(screen.getByText(/overdue by 3 days/)).toBeInTheDocument();
});
test('settings: each kind has its own Email choice, sent separately from the in-app choice', async () => {
  wrap(<NotificationsPage />); const box = await screen.findByLabelText('Email: A finding is assigned to me'); expect(box).toBeChecked();
  fireEvent.click(box); await waitFor(() => expect(api).toHaveBeenCalledWith('PUT', '/me/notification-prefs', { kind: 'finding.assigned', email: false }));
  expect(screen.getByLabelText('Email: Someone comments on a finding I own or raised')).toBeDisabled();   // the app notification is off, so there is nothing to email
});
