import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
vi.mock('./api', () => ({ api: vi.fn(), apiBlob: vi.fn(), apiUpload: vi.fn(), saveBlob: vi.fn(), ApiError: class extends Error {} }));
vi.mock('./auth', () => ({ useAuth: vi.fn() }));
import { api, apiBlob, apiUpload, saveBlob } from './api'; import { useAuth } from './auth'; import { TemplatesPage, TemplateLink } from './pages6';
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const as = (platformRole: string) => (useAuth as any).mockReturnValue({ me: { user: { platformRole }, organizations: [] } });
const bytes = new TextEncoder().encode('hello'); const HELLO = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
const T = (o: any = {}) => ({ id: 't1', name: 'ISMS policy', category: 'Policies', frameworkName: null, versionLabel: 'v1', description: 'Blank', fileName: 'isms.pdf', sizeBytes: 2048, sha256: HELLO, active: 1, ...o });
beforeEach(() => { vi.clearAllMocks(); (api as any).mockImplementation(async (_m: string, url: string) => url.startsWith('/templates') ? [T(), T({ id: 't2', name: 'Old', active: 0, category: null })] : url.startsWith('/frameworks') ? [{ id: 'f1', name: 'ISO' }] : {}); });

test('a client sees templates and can download, but has no upload, edit or retire buttons', async () => {
  as('none'); wrap(<TemplatesPage />); expect(await screen.findByText('ISMS policy')).toBeInTheDocument(); expect(screen.getByLabelText('Download ISMS policy')).toBeInTheDocument();
  expect(screen.queryByText('Add template')).toBeNull(); expect(screen.queryByLabelText('Edit ISMS policy')).toBeNull(); expect(screen.queryByLabelText('Retire ISMS policy')).toBeNull(); expect(screen.queryByLabelText(/Show retired/)).toBeNull();
});
test('isecurify team may upload and edit but not retire; admins may retire', async () => {
  as('isecurify_team'); const { unmount } = wrap(<TemplatesPage />); await screen.findByText('ISMS policy'); expect(screen.getByText('Add template')).toBeInTheDocument(); expect(screen.getByLabelText('Edit ISMS policy')).toBeInTheDocument(); expect(screen.getByLabelText('New version of ISMS policy')).toBeInTheDocument(); expect(screen.queryByLabelText('Retire ISMS policy')).toBeNull(); unmount();
  as('admin'); wrap(<TemplatesPage />); expect(await screen.findByLabelText('Retire ISMS policy')).toBeInTheDocument();
});
test('download verifies the SHA-256 and shows a clear warning on mismatch', async () => {
  as('none'); (apiBlob as any).mockResolvedValueOnce(new Blob([bytes])); wrap(<TemplatesPage />); fireEvent.click(await screen.findByLabelText('Download ISMS policy'));
  expect(await screen.findByText(/SHA-256 matches/)).toBeInTheDocument(); expect(saveBlob).toHaveBeenCalledTimes(1);
  (apiBlob as any).mockResolvedValueOnce(new Blob([new TextEncoder().encode('tampered')])); fireEvent.click(screen.getByLabelText('Download ISMS policy')); expect(await screen.findByText(/WARNING: the downloaded file does not match/)).toBeInTheDocument();
});
test('uploading sends the text fields and the file; a new version carries replacesId', async () => {
  as('isecurify_team'); (apiUpload as any).mockResolvedValue({}); wrap(<TemplatesPage />); fireEvent.click(await screen.findByLabelText('New version of ISMS policy'));
  const form = await screen.findByLabelText('Template upload'); expect(form).toBeInTheDocument(); expect(screen.getByText(/will be retired/)).toBeInTheDocument();
  const file = new File(['%PDF-1.4'], 'v2.pdf', { type: 'application/pdf' }); fireEvent.change(screen.getByLabelText('Template file'), { target: { files: [file] } }); fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  await waitFor(() => expect(apiUpload).toHaveBeenCalled()); const [url, f, fields] = (apiUpload as any).mock.calls[0]; expect(url).toBe('/templates'); expect(f).toBe(file); expect(fields.name).toBe('ISMS policy'); expect(fields.replacesId).toBe('t1');
});
test('submitting without a file shows an error and does not call the server', async () => {
  as('isecurify_team'); wrap(<TemplatesPage />); fireEvent.click(await screen.findByText('Add template')); fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: 'Form' } }); fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  expect(await screen.findByText('Choose a file')).toBeInTheDocument(); expect(apiUpload).not.toHaveBeenCalled();
});
test('retire asks for confirmation first', async () => {
  as('admin'); wrap(<TemplatesPage />); fireEvent.click(await screen.findByLabelText('Retire ISMS policy')); expect((api as any).mock.calls.some((c: any[]) => String(c[1]).endsWith('/retire'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Retire' })); await waitFor(() => expect((api as any).mock.calls.some((c: any[]) => c[0] === 'POST' && c[1] === '/templates/t1/retire')).toBe(true));
});
test('the template link inside a request downloads and verifies too', async () => {
  (apiBlob as any).mockResolvedValueOnce(new Blob([bytes])); wrap(<TemplateLink t={{ id: 't1', name: 'ISMS', fileName: 'isms.pdf', sha256: HELLO }} />); fireEvent.click(screen.getByRole('button', { name: 'Download template' })); expect(await screen.findByText(/SHA-256 matches/)).toBeInTheDocument();
});
