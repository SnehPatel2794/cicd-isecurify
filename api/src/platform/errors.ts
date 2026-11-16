export class HttpError extends Error { constructor(public status: number, msg: string, public code?: string) { super(msg); } }
export const bad = (m = 'Bad request') => new HttpError(400, m);
export const unauthorized = (m = 'Not authenticated', code?: string) => new HttpError(401, m, code);
export const forbidden = (m = 'Forbidden', code?: string) => new HttpError(403, m, code);
export const notFound = () => new HttpError(404, 'Not found');
export const conflict = (m: string) => new HttpError(409, m);
