// Pure helpers for the findings import dialog.
export const formatOf = (filename: string): 'csv' | 'json' | null => /\.json$/i.test(filename) ? 'json' : /\.csv$/i.test(filename) ? 'csv' : null;
export const summaryLine = (r: { total: number; willCreate: number; duplicates: number; invalid: number }) => `${r.total} row${r.total === 1 ? '' : 's'}: ${r.willCreate} new, ${r.duplicates} already imported, ${r.invalid} invalid`;
export const canCommit = (r: { willCreate: number; invalid: number } | null, skipInvalid: boolean) => !!r && r.willCreate > 0 && (r.invalid === 0 || skipInvalid);
export const STATUS_TEXT: Record<string, string> = { new: 'New', duplicate: 'Already imported', invalid: 'Invalid' };
