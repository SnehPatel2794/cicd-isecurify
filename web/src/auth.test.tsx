// Regression found by the browser run: after "Sign out" the screen stayed on the signed-in page.
import { render, screen, waitFor, fireEvent } from '@testing-library/react'; import { QueryClient, QueryClientProvider } from '@tanstack/react-query'; import { vi } from 'vitest';
vi.mock('./api', () => ({ api: vi.fn(), setCsrf: vi.fn(), ApiError: class extends Error { status = 0; } }));
import { api } from './api'; import { AuthProvider, useAuth } from './auth';
const Probe = () => { const { me, logout } = useAuth(); return <div>{me ? <><span>hello {me.user.name}</span><button onClick={logout}>out</button></> : <span>signed out</span>}</div>; };
test('signing out leaves the signed-in state and forgets other cached data', async () => {
  (api as any).mockImplementation(async (m: string, p: string) => { if (p === '/auth/me') return { user: { id: 'u', name: 'Ann' }, organizations: [], csrfToken: 'c' }; return {}; });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); qc.setQueryData(['dashboard', 'o1'], { secret: 1 });
  render(<QueryClientProvider client={qc}><AuthProvider><Probe /></AuthProvider></QueryClientProvider>); expect(await screen.findByText('hello Ann')).toBeInTheDocument();
  fireEvent.click(screen.getByText('out')); await waitFor(() => expect(screen.getByText('signed out')).toBeInTheDocument()); expect(qc.getQueryData(['dashboard', 'o1'])).toBeUndefined();
});
