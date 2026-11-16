// Copy of the reminder rule in api/src/modules/vapt/rules.ts (the worker image does not contain the api folder, so it cannot import it).
// api/test/62_image_imports.test.ts runs both over the same dates and fails if they ever differ.
export type Stage = 'upcoming' | 'due' | 'overdue';
export const UPCOMING_DAYS = 7; export const OVERDUE_AFTER_DAYS = 3;
const days = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
/** Reminder stage for a planned round that has not started: a week before, on the day, and once it is 3 days late. */
export function reminderStage(plannedOn: string, today: string): Stage | null { const n = days(today, plannedOn); if (n > UPCOMING_DAYS) return null; if (n > 0) return 'upcoming'; return -n >= OVERDUE_AFTER_DAYS ? 'overdue' : 'due'; }
