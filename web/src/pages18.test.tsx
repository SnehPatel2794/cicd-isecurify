import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
vi.mock('./api', () => ({ api: vi.fn(), apiUpload: vi.fn(), ApiError: class extends Error { constructor(public status: number, m: string) { super(m); } } }));
import { api, apiUpload } from './api'; import { BrandingPage } from './pages18'; import { BrandMark } from './branding';
import { isHex, contrast, primaryProblem, brandVars, logoProblem, logoUrl, sameProfile, DEFAULTS } from './brandingUi';
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
beforeEach(() => vi.clearAllMocks());
const P = (o: any = {}) => ({ ...DEFAULTS, hasLogo: false, version: 1, logo: null, ...o });
const serve = (p: any) => (api as any).mockImplementation(async (m: string, url: string) => m === 'GET' ? (url === '/branding' ? p : p) : { ok: true });

test('helpers: colours, contrast, palette, logo checks', () => {
  expect(isHex('#812671')).toBe(true); expect(isHex('812671')).toBe(false); expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
  expect(primaryProblem('#812671')).toBeNull(); expect(primaryProblem('#1b887d')).not.toBeNull(); expect(primaryProblem('nope')).not.toBeNull();
  expect(brandVars('#812671')['--brand']).toBe('129 38 113'); expect(brandVars('bad')['--brand']).toBe('129 38 113');
  expect(logoProblem({ type: 'image/gif', size: 10 })).toMatch(/PNG or JPG/); expect(logoProblem({ type: 'image/png', size: 3 * 1024 * 1024 })).toMatch(/2 MB/); expect(logoProblem({ type: 'image/png', size: 100 })).toBeNull();
  expect(logoUrl(3)).toBe('/api/branding/logo?v=3'); expect(sameProfile(DEFAULTS, { ...DEFAULTS })).toBe(true); expect(sameProfile(DEFAULTS, { ...DEFAULTS, companyName: 'X' })).toBe(false);
});
test('mark shows the name when there is no logo, and the logo when there is', async () => {
  serve(P({ companyName: 'Acme GRC' })); wrap(<BrandMark />); expect(await screen.findByText('Acme GRC')).toBeInTheDocument();
});
test('mark shows the logo image', async () => {
  serve(P({ hasLogo: true, version: 4 })); wrap(<BrandMark />); const img = await screen.findByRole('img'); expect(img).toHaveAttribute('src', '/api/branding/logo?v=4');
});
test('page: save is disabled until something changes, then sends the form', async () => {
  serve(P()); wrap(<BrandingPage />); const name = await screen.findByLabelText('Company name'); const save = screen.getByRole('button', { name: 'Save' }); expect(save).toBeDisabled();
  fireEvent.change(name, { target: { value: 'Acme GRC' } }); expect(save).toBeEnabled(); fireEvent.click(save);
  await waitFor(() => expect(api).toHaveBeenCalledWith('PUT', '/platform/branding', expect.objectContaining({ companyName: 'Acme GRC', primaryColor: '#812671' })));
});
test('page: a primary colour that is too light is refused with a reason', async () => {
  serve(P()); wrap(<BrandingPage />); await screen.findByLabelText('Company name'); fireEvent.change(screen.getByLabelText('Primary colour'), { target: { value: '#1b887d' } });
  expect(screen.getByRole('alert')).toHaveTextContent('Too light for white text'); expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
});
test('page: a bad hex value blocks saving', async () => {
  serve(P()); wrap(<BrandingPage />); await screen.findByLabelText('Company name'); fireEvent.change(screen.getByLabelText('Accent colour'), { target: { value: '#12' } });
  expect(screen.getByText('Use a colour like #812671')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
});
test('logo: wrong type is rejected in the browser, a good file is uploaded, removal works', async () => {
  serve(P({ hasLogo: true, logo: { mime: 'image/png' } })); wrap(<BrandingPage />); const input = await screen.findByLabelText(/Upload a logo/);
  fireEvent.change(input, { target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] } }); expect(await screen.findByText('The logo must be a PNG or JPG image')).toBeInTheDocument(); expect(apiUpload).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } }); await waitFor(() => expect(apiUpload).toHaveBeenCalledWith('/platform/branding/logo', expect.any(File)));
  fireEvent.click(screen.getByRole('button', { name: 'Remove logo' })); await waitFor(() => expect(api).toHaveBeenCalledWith('DELETE', '/platform/branding/logo'));
});
test('page: a server error is shown', async () => {
  (api as any).mockImplementation(async (m: string) => { if (m === 'GET') return P(); throw new (await import('./api')).ApiError(403, 'Not allowed'); }); wrap(<BrandingPage />);
  fireEvent.change(await screen.findByLabelText('Company name'), { target: { value: 'Z' } }); fireEvent.click(screen.getByRole('button', { name: 'Save' })); expect(await screen.findByText('Not allowed')).toBeInTheDocument();
});
