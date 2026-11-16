import { render, screen, waitFor, fireEvent } from '@testing-library/react'; import { QueryClient, QueryClientProvider } from '@tanstack/react-query'; import { MemoryRouter, Routes, Route } from 'react-router-dom'; import { vi } from 'vitest';
vi.mock('./api', () => ({ api: vi.fn(), ApiError: class extends Error {} })); vi.mock('./auth', () => ({ useAuth: vi.fn() }));
import { api } from './api'; import { useAuth } from './auth'; import { IntegrationsPage } from './pages23'; import { endpointState } from './integrationsUi';
const wrap = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/org/o1/integrations']}><Routes><Route path="/org/:tid/integrations" element={<IntegrationsPage />} /></Routes></MemoryRouter></QueryClientProvider>);
const as = (role: string, via = 'member') => (useAuth as any).mockReturnValue({ me: { user: { id: 'u1', name: 'Me' }, organizations: [{ id: 'o1', name: 'Acme', via, role }] } });
const KEY = { id: 'k1', name: 'Scanner', prefix: 'abcd1234', scopes: ['findings:write'], lastUsedAt: null, state: 'active', createdByName: 'Me' };
const serve = (hooks: any = { configured: true, endpoints: [] }) => (api as any).mockImplementation(async (m: string, p: string) => { if (p.endsWith('/integrations/scopes')) return { scopes: [{ id: 'findings:write', label: 'Raise findings' }, { id: 'items:read', label: 'Read items' }] }; if (p.endsWith('/api-keys') && m === 'GET') return { keys: [KEY] }; if (p.endsWith('/api-keys') && m === 'POST') return { id: 'k2', key: 'isg_11112222_SECRETVALUE' }; if (p.endsWith('/webhooks') && m === 'GET') return hooks; if (p.endsWith('/webhooks') && m === 'POST') return { id: 'w1', secret: 'whsec_ONCE' }; return { ok: true }; });
beforeEach(() => vi.clearAllMocks());
test('only managers see the page; others get a clear message and no API call', () => { as('client_staff'); serve(); wrap(); expect(screen.getByText(/Only organization administrators/)).toBeTruthy(); expect(api).not.toHaveBeenCalled(); });
test('staff with manage access and client admins can open it', async () => { as('auditor', 'staff'); serve(); wrap(); expect(await screen.findByText('Scanner')).toBeTruthy(); expect(screen.getByText('isg_abcd1234…')).toBeTruthy(); });
test('creating a key requires a name and a scope, then shows the key once and never lists it', async () => {
  as('client_admin'); serve(); wrap(); fireEvent.click(await screen.findByText('Create API key')); const submit = await screen.findByText('Create key'); expect((submit as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'CI scanner' } }); fireEvent.click(await screen.findByLabelText(/Raise findings/)); expect((submit as HTMLButtonElement).disabled).toBe(false); fireEvent.click(submit);
  expect(await screen.findByDisplayValue('isg_11112222_SECRETVALUE')).toBeTruthy(); expect(api).toHaveBeenCalledWith('POST', '/t/o1/api-keys', { name: 'CI scanner', scopes: ['findings:write'], expiresInDays: 90 });
  fireEvent.click(screen.getByText('I have saved it')); await waitFor(() => expect(screen.queryByDisplayValue('isg_11112222_SECRETVALUE')).toBeNull());
});
test('webhooks: explains when switched off; when on, adding shows the secret once', async () => {
  as('client_admin'); serve({ configured: false, endpoints: [] }); wrap(); fireEvent.click(await screen.findByText('Webhooks')); expect(await screen.findByText(/switched off on this installation/)).toBeTruthy(); expect(screen.queryByText('Add webhook')).toBeNull();
});
test('webhooks: add flow and state labels', async () => {
  as('client_admin'); serve(); wrap(); fireEvent.click(await screen.findByText('Webhooks')); fireEvent.click(await screen.findByText('Add webhook')); fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'SIEM' } }); fireEvent.change(screen.getByLabelText(/^Address/), { target: { value: 'https://siem.example.com/h' } }); fireEvent.click((a => a[a.length - 1])(screen.getAllByText('Add webhook')));
  expect(await screen.findByDisplayValue('whsec_ONCE')).toBeTruthy(); expect(api).toHaveBeenCalledWith('POST', '/t/o1/webhooks', { name: 'SIEM', url: 'https://siem.example.com/h', events: ['*'] });
  expect(endpointState({ active: false, disabledReason: 'x', consecutiveFailures: 15 }).label).toBe('Switched off'); expect(endpointState({ active: true, consecutiveFailures: 2 }).label).toBe('Failing (2)'); expect(endpointState({ active: true, consecutiveFailures: 0 }).label).toBe('Working');
});
