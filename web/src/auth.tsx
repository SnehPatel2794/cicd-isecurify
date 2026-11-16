import { createContext, useContext, ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setCsrf } from './api';
export type OrgRef = { id: string; name: string; status: string; via: 'member' | 'staff'; role: string };
export type Me = { organizations: OrgRef[]; user: { id: string; name: string; email: string; platformRole: string }; mfa: { enabled: boolean }; mfaEnrollmentRequired: boolean; csrfToken: string };
type Ctx = { me: Me | null; loading: boolean; refresh: () => Promise<unknown>; logout: () => Promise<void> };
const AuthCtx = createContext<Ctx>({ me: null, loading: true, refresh: async () => {}, logout: async () => {} });
export const useAuth = () => useContext(AuthCtx);
export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me'], retry: false, staleTime: 60_000, queryFn: async () => {
    try { const m = await api<Me>('GET', '/auth/me'); setCsrf(m.csrfToken); return m; }
    catch (e) { if (e instanceof ApiError && e.status === 401) return null; throw e; } } });
  const logout = async () => { try { await api('POST', '/auth/logout'); } catch { /* already gone */ } setCsrf(''); qc.setQueryData(['me'], null); qc.removeQueries({ predicate: k => k.queryKey[0] !== 'me' }); };   // keep the mounted 'me' query (now: nobody) so the screen leaves the app, and drop everything else the last person could see
  return <AuthCtx.Provider value={{ me: q.data ?? null, loading: q.isLoading, refresh: () => qc.invalidateQueries({ queryKey: ['me'] }), logout }}>{children}</AuthCtx.Provider>;
}
