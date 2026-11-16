export class ApiError extends Error { constructor(public status: number, message: string, public code?: string) { super(message); } }
let csrf = '';
export const setCsrf = (t: string) => { csrf = t; };
export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}; if (body !== undefined) headers['content-type'] = 'application/json'; if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf;
  const r = await fetch('/api' + url, { method, credentials: 'same-origin', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data: any = null; try { data = await r.json(); } catch { /* empty */ }
  if (data?.csrfToken) setCsrf(data.csrfToken);
  if (!r.ok) throw new ApiError(r.status, data?.error || 'Request failed', data?.code);
  return data as T;
}

export async function apiBlob(url: string): Promise<Blob> {
  const r = await fetch('/api' + url, { credentials: 'same-origin' });
  if (!r.ok) { let m = 'Download failed'; try { m = (await r.json()).error || m; } catch { /* ignore */ } throw new ApiError(r.status, m); }
  return r.blob();
}
export function saveBlob(blob: Blob, name: string) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }

/** Text fields are appended BEFORE the file: the server reads them from the multipart stream in order. */
export async function apiUpload<T = any>(url: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v); fd.append('file', file); const headers: Record<string, string> = {}; if (csrf) headers['x-csrf-token'] = csrf;
  const r = await fetch('/api' + url, { method: 'POST', credentials: 'same-origin', headers, body: fd }); let data: any = null; try { data = await r.json(); } catch { /* none */ }
  if (!r.ok) throw new ApiError(r.status, data?.error || 'Upload failed', data?.code); return data as T;
}

/** POST that returns a file (used for exports). Reads the server's fingerprint header so the screen can show what was recorded. */
export async function apiDownloadPost(url: string, body: unknown): Promise<{ blob: Blob; filename: string; sha256: string | null; id: string | null }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }; if (csrf) headers['x-csrf-token'] = csrf;
  const r = await fetch('/api' + url, { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify(body) });
  if (!r.ok) { let m = 'Export failed'; try { m = (await r.json()).error || m; } catch { /* ignore */ } throw new ApiError(r.status, m); }
  const cd = r.headers.get('content-disposition') ?? ''; const filename = /filename="([^"]+)"/.exec(cd)?.[1] ?? 'export';
  return { blob: await r.blob(), filename, sha256: r.headers.get('x-report-sha256'), id: r.headers.get('x-report-id') };
}
