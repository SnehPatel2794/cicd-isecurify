import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
vi.mock('./api', () => ({ api: vi.fn(), ApiError: class extends Error {} }));
import { api } from './api'; import { ImportDialog } from './pages11'; import { formatOf, summaryLine, canCommit } from './importUi';
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const PRE = (o: any = {}) => ({ committed: false, total: 3, willCreate: 2, duplicates: 0, invalid: 1, bySeverity: {}, rows: [{ row: 1, title: 'TLS 1.0', severity: 'critical', itemRef: 'X-1', status: 'new', message: null }, { row: 2, title: 'SSH', severity: 'medium', itemRef: 'X-1', status: 'new', message: null }, { row: 3, title: 'Odd', severity: 'low', itemRef: null, status: 'invalid', message: 'No checklist item' }], ...o });
const setup = (pre: any) => (api as any).mockImplementation(async (m: string, url: string, body: any) => m === 'GET' ? { items: [{ id: 'i1', ref: 'X-1', title: 'MFA', readiness: 'implemented' }, { id: 'i2', ref: 'X-2', title: 'NA', readiness: 'not_applicable' }] } : body.commit ? { ...pre, committed: true, willCreate: 2, duplicates: 0, invalid: 1 } : pre);
const pick = async (name = 'scan.csv') => fireEvent.change(await screen.findByLabelText('Results file'), { target: { files: [new File(['Title,Severity\na,low'], name)] } });
beforeEach(() => vi.clearAllMocks());
test('helpers', () => { expect(formatOf('a.CSV')).toBe('csv'); expect(formatOf('x.json')).toBe('json'); expect(formatOf('x.xml')).toBeNull(); expect(summaryLine({ total: 1, willCreate: 1, duplicates: 0, invalid: 0 })).toBe('1 row: 1 new, 0 already imported, 0 invalid'); expect(canCommit(null, true)).toBe(false); expect(canCommit({ willCreate: 0, invalid: 0 }, false)).toBe(false); expect(canCommit({ willCreate: 2, invalid: 1 }, false)).toBe(false); expect(canCommit({ willCreate: 2, invalid: 1 }, true)).toBe(true); });
test('choosing a file previews it without importing; not-applicable items are not offered as the default', async () => {
  setup(PRE()); wrap(<ImportDialog tid="t" eid="e" onClose={() => {}} onDone={() => {}} />); await pick(); expect(await screen.findByText('3 rows: 2 new, 0 already imported, 1 invalid')).toBeInTheDocument(); expect(screen.getByText('No checklist item')).toBeInTheDocument();
  expect(screen.queryByText(/X-2 — NA/)).toBeNull(); expect(await screen.findByText(/X-1 — MFA/)).toBeInTheDocument(); expect((api as any).mock.calls.filter((c: any[]) => c[0] === 'POST').every((c: any[]) => c[2].commit === false)).toBe(true);
});
test('invalid rows block the import until they are skipped; then it commits with the chosen default item', async () => {
  setup(PRE()); const done = vi.fn(); wrap(<ImportDialog tid="t" eid="e" onClose={() => {}} onDone={done} />); await pick(); const btn = await screen.findByRole('button', { name: 'Import 2 findings' }); expect(btn).toBeDisabled();
  await screen.findByText(/X-1 — MFA/); fireEvent.change(screen.getByLabelText('Default checklist item'), { target: { value: 'X-1' } }); fireEvent.click(await screen.findByLabelText(/Skip the invalid rows/)); expect(screen.getByRole('button', { name: 'Import 2 findings' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Import 2 findings' })); expect(await screen.findByText(/Imported 2 findings/)).toBeInTheDocument(); expect(done).toHaveBeenCalled();
  expect(api).toHaveBeenCalledWith('POST', '/t/t/engagements/e/findings/import', expect.objectContaining({ commit: true, skipInvalid: true, defaultItemRef: 'X-1', filename: 'scan.csv', format: 'csv' }));
});
test('an unsupported file type is refused and server errors are shown', async () => {
  setup(PRE()); wrap(<ImportDialog tid="t" eid="e" onClose={() => {}} onDone={() => {}} />); await pick('scan.xml'); expect(await screen.findByRole('alert')).toBeInTheDocument(); expect((api as any).mock.calls.some((c: any[]) => c[0] === 'POST')).toBe(false);
});
