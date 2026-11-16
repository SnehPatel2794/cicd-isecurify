import { describe, it, expect, vi, beforeEach } from 'vitest'; import { render, screen } from '@testing-library/react'; import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SystemPage } from './pages16'; import * as apiMod from './api';
const base = { status: 'ok', warnings: [], version: '1.0.0', node: 'v22', production: true, uptimeSeconds: 7300, schema: { count: 19, latest: '019_backup_log.sql' }, backups: { backup: 'ok', drill: 'ok', lastBackup: { at: new Date().toISOString(), ageHours: 3, encrypted: true }, lastDrill: { at: new Date().toISOString(), ageDays: 4 }, log: [{ id: 1, kind: 'backup', ok: true, takenAt: new Date().toISOString(), dbBytes: 2048000, evidenceBytes: 100, encrypted: true, note: null }] }, queue: { pending: 0, running: 0, dead: 0, oldestPendingMinutes: null }, email: { configured: true, failedLast24h: 0 }, security: { mfaRequiredForPlatform: true } };
const show = (d: any) => { vi.spyOn(apiMod, 'api').mockResolvedValue(d); render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SystemPage /></QueryClientProvider>); };
beforeEach(() => vi.restoreAllMocks());
describe('SystemPage', () => {
  it('shows a healthy installation', async () => { show(base); expect(await screen.findByText('All good')).toBeTruthy(); expect(screen.getByText('Proven')).toBeTruthy(); expect(screen.getByText(/2 h 1 min/)).toBeTruthy(); });
  it('lists warnings and a missing drill', async () => { show({ ...base, status: 'attention', warnings: ['No restore drill has been recorded.'], backups: { ...base.backups, drill: 'never', lastDrill: null } }); expect(await screen.findByText('Needs attention', { selector: 'span' })).toBeTruthy(); expect(screen.getByText('No restore drill has been recorded.')).toBeTruthy(); expect(screen.getByText('Never run')).toBeTruthy(); });
});
it('shows the off-server copy state and disk space', async () => {
  show({ ...base, backups: { ...base.backups, offsite: 'not_configured', lastOffsite: null }, disk: { freeBytes: 5 * 1073741824, totalBytes: 20 * 1073741824 } }); expect(await screen.findByText('backups are kept on this server only')).toBeInTheDocument(); expect(screen.getByText(/free of/)).toBeInTheDocument();
});
it('flags a stale off-server copy and labels its log rows', async () => {
  show({ ...base, backups: { ...base.backups, offsite: 'stale', lastOffsite: { at: '2026-10-01T00:00:00Z', ageHours: 60 }, log: [{ id: 9, kind: 'offsite', ok: true, takenAt: '2026-10-01T00:00:00Z', dbBytes: null, evidenceBytes: null, note: 'copied and verified with rsync' }] } }); expect(await screen.findByText('stale')).toBeInTheDocument(); expect(screen.getByText('Off-server copy', { selector: 'td' })).toBeInTheDocument();
});
