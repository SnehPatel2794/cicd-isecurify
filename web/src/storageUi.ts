// Pure helpers for the storage screens.
import { fmtBytes } from './evidenceUi';
export const quotaText = (o: { unlimited: boolean; quotaBytes: number | null; quotaIsDefault: boolean }) => o.unlimited ? 'No limit' : `${fmtBytes(o.quotaBytes)}${o.quotaIsDefault ? ' (default)' : ' (set for this organization)'}`;
export const diskText = (d: { freeBytes: number; totalBytes: number; low: boolean } | null) => !d ? 'Disk space is not available' : `${fmtBytes(d.freeBytes)} free of ${fmtBytes(d.totalBytes)}${d.low ? ' — uploads are paused until more space is free' : ''}`;
export const holdProblem = (reason: string) => reason.trim().length < 3 ? 'Say why the hold is placed (at least 3 characters)' : reason.trim().length > 300 ? 'The reason is too long (300 characters at most)' : null;
export const retentionText = (months: number) => months % 12 === 0 ? `${months / 12} year${months === 12 ? '' : 's'}` : `${months} months`;
