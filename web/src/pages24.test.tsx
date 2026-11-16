import { test, expect, vi, beforeEach, afterEach } from 'vitest'; import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'; import { QueryClient, QueryClientProvider } from '@tanstack/react-query'; import { MemoryRouter } from 'react-router-dom';
vi.mock('./api', async (orig) => ({ ...(await orig<any>()), api: vi.fn() }));
import { api } from './api'; import { AdvanceDialog, SignoffTab, AddFrameworkDialog } from './pages24';
const wrap = (ui: any) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
beforeEach(() => (api as any).mockReset()); afterEach(cleanup);
const chk = (checks: any[]) => ({ from: 2, to: 3, fromName: 'Evidence', toName: 'Review', checks, blocked: checks.filter(c => c.level === 'block').length, warnings: checks.filter(c => c.level === 'warn').length, canAdvance: !checks.some(c => c.level === 'block') });

test('a warning needs a tick and a reason before the phase can advance, and both are sent', async () => {
  (api as any).mockImplementation(async (m: string, u: string) => (u ?? '').endsWith('phase-check') ? chk([{ code: 'overdue', level: 'warn', message: '2 items are overdue' }]) : {});
  wrap(<AdvanceDialog tid="t" eid="e" onClose={() => {}} onDone={() => {}} />); expect(await screen.findByText('2 items are overdue')).toBeTruthy();
  const btn = screen.getByRole('button', { name: /advance/i }) as HTMLButtonElement; expect(btn.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Agreed with client' } }); expect(btn.disabled).toBe(false); fireEvent.click(btn);
  await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/t/t/engagements/e/advance-phase', { acknowledge: true, note: 'Agreed with client' }));
});
test('a block cannot be acknowledged away', async () => {
  (api as any).mockResolvedValue(chk([{ code: 'no_items', level: 'block', message: 'The checklist is empty' }])); wrap(<AdvanceDialog tid="t" eid="e" onClose={() => {}} onDone={() => {}} />);
  expect(await screen.findByText('The checklist is empty')).toBeTruthy(); expect((screen.getByRole('button', { name: /advance/i }) as HTMLButtonElement).disabled).toBe(true); expect(screen.queryByRole('checkbox')).toBeNull();
});
test('the auditor can only pick an opinion that is allowed and must explain it', async () => {
  (api as any).mockImplementation(async (m: string) => m === 'GET' ? { current: null, history: [], hasAuditor: true, blockedClose: 'The third-party auditor has not signed off', can: { sign: true, waive: false, withdraw: false }, waiverReason: null,
    opinions: [{ opinion: 'unqualified', label: 'Unqualified', allowed: false, reason: '2 controls not effective' }, { opinion: 'qualified', label: 'Qualified', allowed: true, reason: null }] } : {});
  wrap(<SignoffTab tid="t" eid="e" d={{ status: 'active' }} refresh={() => {}} />); expect((await screen.findAllByText(/has not signed off/)).length).toBeGreaterThan(0);
  expect((screen.getByLabelText(/Unqualified/) as HTMLInputElement).disabled).toBe(true); fireEvent.click(screen.getByLabelText(/^ ?Qualified/));
  const go = screen.getByRole('button', { name: 'Sign off' }) as HTMLButtonElement; expect(go.disabled).toBe(true); fireEvent.change(screen.getByLabelText(/Basis/), { target: { value: 'Two exceptions noted in access reviews' } }); expect(go.disabled).toBe(false);
});
test('a framework already on the engagement is not offered again', async () => {
  (api as any).mockResolvedValue([{ frameworkId: 'f1', releaseId: 'r1', name: 'ISO 27001', version: '1', controlCount: 10 }, { frameworkId: 'f2', releaseId: 'r2', name: 'SOC 2', version: '1', controlCount: 8 }]);
  wrap(<AddFrameworkDialog tid="t" eid="e" have={['f1']} onClose={() => {}} onDone={() => {}} />); expect(await screen.findByText(/SOC 2/)).toBeTruthy(); expect(screen.queryByText(/ISO 27001/)).toBeNull();
});

import { VaptTab } from './pages24';
const vapt = (over: any = {}) => ({ engagementId: 'e', engagementStatus: 'active', max: 8, can: { manage: true }, trend: 'improving', rounds: [{ id: 'r1', roundNo: 1, title: 'External', status: 'closed', statusLabel: 'Closed', plannedOn: '2026-02-01', reportTitle: 'Report v1', reportRef: 'REF-1', findings: 3, openFindings: 0, next: [] }],
  comparison: [{ roundId: 'r1', roundNo: 1, title: 'External', found: 3, foundSerious: 1, carriedIn: 0, closedAfter: 2, stillOpen: 0 }], ...over });
test('the VAPT tab lists rounds and the comparison, and offers planning only to those who can manage', async () => {
  (api as any).mockResolvedValue(vapt()); wrap(<VaptTab tid="t" eid="e" d={{}} refresh={() => {}} />); expect(await screen.findByText('Report v1')).toBeTruthy(); expect(screen.getByText(/Round-to-round comparison/)).toBeTruthy(); expect(screen.getByText(/fewer serious findings/)).toBeTruthy(); expect(screen.getByRole('button', { name: 'Plan a round' })).toBeTruthy();
  cleanup(); (api as any).mockResolvedValue(vapt({ can: { manage: false } })); wrap(<VaptTab tid="t" eid="e" d={{}} refresh={() => {}} />); await screen.findByText('Report v1'); expect(screen.queryByRole('button', { name: 'Plan a round' })).toBeNull();
});
test('planning a round sends the name and date', async () => {
  (api as any).mockImplementation(async (m: string, u: string) => m === 'GET' ? vapt({ rounds: [], comparison: [] }) : { id: 'x' }); wrap(<VaptTab tid="t" eid="e" d={{}} refresh={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Plan a round' })); fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Round 1' } }); fireEvent.change(screen.getByLabelText(/Planned start/), { target: { value: '2026-12-01' } }); fireEvent.click(screen.getByRole('button', { name: 'Plan round' }));
  await waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/t/t/engagements/e/vapt-rounds', { title: 'Round 1', scope: null, tester: null, plannedOn: '2026-12-01' }));
});
