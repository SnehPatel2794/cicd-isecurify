import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
vi.mock('./api', () => ({ api: vi.fn(), ApiError: class extends Error {} }));
import { api, ApiError } from './api'; import { EmailPage } from './pages8';
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const S = (o: any = {}) => ({ configured: true, host: 'smtp.example.com', port: 587, tls: 'starttls', from: 'iSecurify <noreply@example.com>', origin: 'https://grc.example.com', queue: { pending: 1, running: 0, dead: 2 }, lastResult: { status: 'failed', createdAt: '2026-10-01T10:00:00Z' },
  log: [{ id: 2, toEmail: 'b@x.test', subject: 'Invite', status: 'failed', error: '550 no such user', createdAt: '2026-10-01T10:00:00Z' }, { id: 1, toEmail: 'a@x.test', subject: 'Reset', status: 'sent', error: null, createdAt: '2026-10-01T09:00:00Z' }], ...o });
beforeEach(() => { vi.clearAllMocks(); (api as any).mockImplementation(async (m: string, url: string) => m === 'POST' ? { ok: true } : S()); });

test('shows the configuration, queue and the delivery log with failures explained', async () => {
  wrap(<EmailPage />); expect(await screen.findByText('Configured')).toBeInTheDocument(); expect(screen.getByText('smtp.example.com:587')).toBeInTheDocument(); expect(screen.getByText(/STARTTLS/)).toBeInTheDocument();
  expect(screen.getByText(/1 waiting, 0 sending, 2 given up/)).toBeInTheDocument(); expect(screen.getByText('550 no such user')).toBeInTheDocument(); expect(screen.getAllByText('Sent').length).toBe(2);   // the log badge and the filter option expect(screen.queryByText(/password/i)).toBeNull();
});
test('not configured: says what to set and never shows credentials', async () => {
  (api as any).mockImplementation(async () => S({ configured: false, host: null, port: null, tls: null, from: null, log: [] })); wrap(<EmailPage />);
  expect(await screen.findByText('Not configured')).toBeInTheDocument(); expect(screen.getByText(/SMTP_HOST/)).toBeInTheDocument(); expect(screen.getByText('No messages yet.')).toBeInTheDocument();
});
test('send test posts the address, confirms, and shows server errors', async () => {
  wrap(<EmailPage />); fireEvent.change(await screen.findByLabelText('Send a test message to'), { target: { value: 'me@example.org' } }); fireEvent.click(screen.getByText('Send test'));
  await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/platform/email/test', { to: 'me@example.org' })); expect(await screen.findByText(/Test message queued for me@example.org/)).toBeInTheDocument();
  (api as any).mockImplementation(async (m: string) => { if (m === 'POST') throw new (ApiError as any)('Too many test messages. Please try again later.'); return S(); }); fireEvent.click(screen.getByText('Send test')); expect(await screen.findByText(/Too many test messages/)).toBeInTheDocument();
});
test('the filter asks the server for failed messages only', async () => {
  wrap(<EmailPage />); fireEvent.change(await screen.findByLabelText('Filter log'), { target: { value: 'failed' } }); await waitFor(() => expect(api).toHaveBeenCalledWith('GET', '/platform/email?status=failed'));
});
test('event queue: parked events are listed with the reason and can be retried', async () => {
  (api as any).mockImplementation(async (m: string) => m === 'POST' ? { retried: 2 } : S({ outbox: { pending: 3, dead: 2, done: 10, deadEvents: [{ id: 1, type: 'notification.created', attempts: 5, lastError: 'boom' }] } }));
  wrap(<EmailPage />); const box = await screen.findByLabelText('Event queue'); expect(box).toHaveTextContent('3 waiting, 2 parked'); expect(box).toHaveTextContent('notification.created: boom (5 tries)');
  fireEvent.click(screen.getByRole('button', { name: 'Retry parked events' })); await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/platform/email/outbox/retry')); expect(await screen.findByText('2 events put back in the queue.')).toBeInTheDocument();
});
test('event queue: no retry button when nothing is parked', async () => {
  (api as any).mockImplementation(async () => S({ outbox: { pending: 0, dead: 0, done: 1, deadEvents: [] } })); wrap(<EmailPage />); await screen.findByLabelText('Event queue'); expect(screen.queryByRole('button', { name: 'Retry parked events' })).toBeNull();
});
