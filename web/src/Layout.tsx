import { useQuery } from '@tanstack/react-query'; import { api } from './api'; import { BrandMark } from './branding'; import { SearchBox } from './pages20'; import { NavLink, Outlet, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { NotificationBell } from './notifications'; import { useAuth } from './auth'; import { Spinner } from './ui'; import { WidgetGrid } from './widgets';
export function Protected() {
  const { me, loading } = useAuth(); if (loading) return <Spinner />; if (!me) return <Navigate to="/login" replace />;
  return <Shell />;
}
export function StagingBar() {
  const q = useQuery({ queryKey: ['environment'], queryFn: () => api<{ environment: string }>('GET', '/environment'), staleTime: 300_000, retry: false });
  return q.data?.environment === 'staging' ? <div role="status" className="bg-amber-400 px-3 py-1 text-center text-xs font-semibold text-slate-900">STAGING: a test copy. Nothing here is real, and no email is sent.</div> : null;
}
function Shell() {
  const { me, logout } = useAuth(); const platform = me!.user.platformRole !== 'none'; const admin = ['super_admin', 'admin'].includes(me!.user.platformRole); const nav = useNavigate(); const loc = useLocation(); const current = /^\/org\/([^/]+)/.exec(loc.pathname)?.[1] ?? '';
  const link = ({ isActive }: { isActive: boolean }) => `block rounded px-3 py-2 text-sm ${isActive ? 'bg-brand-light font-medium text-brand' : 'text-slate-700 hover:bg-slate-100'}`;
  return (<div className="flex min-h-screen flex-col"><StagingBar /><div className="flex flex-1">
    <aside className="hidden w-56 shrink-0 border-r bg-white p-3 md:block"><div className="mb-4 px-3 text-lg font-semibold text-brand"><BrandMark /></div>
      <nav aria-label="Main"><NavLink to="/" end className={link}>Home</NavLink><NavLink to="/my-work" className={link}>My work</NavLink><NavLink to="/help" className={link}>Help</NavLink>
        {me!.organizations.map(o => <NavLink key={o.id + o.via} to={`/org/${o.id}/engagements`} className={link}>{o.name}</NavLink>)}
        {current && me!.organizations.some(o => o.id === current) && <NavLink to={`/org/${current}/items`} className={link}>Checklist items</NavLink>}
        {current && me!.organizations.some(o => o.id === current) && <NavLink to={`/org/${current}/continuous`} className={link}>Continuous controls</NavLink>}
        {current && me!.organizations.some(o => o.id === current && (o.role === 'client_admin' || o.via === 'staff')) && <NavLink to={`/org/${current}/integrations`} className={link}>Integrations</NavLink>}
        {current && me!.organizations.some(o => o.id === current) && <NavLink to={`/org/${current}/timeline`} className={link}>Activity</NavLink>}
        {current && me!.organizations.some(o => o.id === current) && <NavLink to={`/org/${current}/findings`} className={link}>Findings &amp; remediation</NavLink>}
        {current && me!.organizations.some(o => o.id === current) && <NavLink to={`/org/${current}/risks`} className={link}>Risk register</NavLink>}
        {current && me!.organizations.some(o => o.id === current) && <NavLink to={`/org/${current}/policies`} className={link}>Policies</NavLink>}
        {current && me!.organizations.some(o => o.id === current) && <NavLink to={`/org/${current}/incidents`} className={link}>Incidents</NavLink>}
        {current && me!.organizations.some(o => o.id === current && (o.via === 'staff' || ['client_admin', 'tp_auditor', 'third_party_vendor'].includes(o.role))) && <NavLink to={`/org/${current}/vendors`} className={link}>Vendors</NavLink>}
        {current && me!.organizations.some(o => o.id === current && (o.via === 'staff' || o.role === 'client_admin')) && <NavLink to={`/org/${current}/quarantine`} className={link}>Quarantine</NavLink>}
        {current && me!.organizations.some(o => o.id === current && (o.via === 'staff' || ['client_admin', 'tp_auditor'].includes(o.role))) && <NavLink to={`/org/${current}/certificates`} className={link}>Certificates</NavLink>}
        {current && me!.organizations.some(o => o.id === current && (o.via === 'staff' || ['client_admin', 'tp_auditor'].includes(o.role))) && <NavLink to={`/org/${current}/analytics`} className={link}>Analytics</NavLink>}
        {platform && <NavLink to="/analytics" className={link}>Portfolio overview</NavLink>}
        {platform && <><div className="mt-3 px-3 text-xs font-semibold uppercase text-slate-400">Library</div><NavLink to="/frameworks" className={link}>Frameworks</NavLink><NavLink to="/common-controls" className={link}>Common controls</NavLink><NavLink to="/templates" className={link}>Evidence templates</NavLink><NavLink to="/process" className={link}>Process &amp; discovery</NavLink></>}
        {admin && <><div className="mt-3 px-3 text-xs font-semibold uppercase text-slate-400">Administration</div><NavLink to="/organizations" className={link}>Organizations</NavLink><NavLink to="/users" className={link}>Users</NavLink><NavLink to="/audit" className={link}>Audit log</NavLink><NavLink to="/mapping-approvals" className={link}>Mapping approvals</NavLink><NavLink to="/email" className={link}>Email delivery</NavLink><NavLink to="/platform/system" className={link}>System status</NavLink><NavLink to="/platform/storage" className={link}>Storage</NavLink>{me!.user.platformRole === 'super_admin' && <NavLink to="/branding" className={link}>Branding</NavLink>}</>}
        {!platform && me!.organizations.length > 0 && <NavLink to="/templates" className={link}>Evidence templates</NavLink>}
        <NavLink to="/security" className={link}>Account security</NavLink></nav></aside>
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b bg-white px-4 py-2">
        <select aria-label="Organization" className="rounded border px-2 py-1 text-sm" value={current} onChange={e => nav(e.target.value ? `/org/${e.target.value}/engagements` : '/')}><option value="">{me!.organizations.length ? 'Select organization…' : 'No organizations'}</option>{me!.organizations.map(o => <option key={o.id + o.via} value={o.id}>{o.name}</option>)}</select>
        <SearchBox />
        <NotificationBell />
        <span className="hidden text-sm sm:inline">{me!.user.name}</span><button className="btn-secondary" onClick={logout}>Sign out</button></header>
      <main className="flex-1 p-4">{me!.mfaEnrollmentRequired && <p role="alert" className="mb-4 rounded bg-amber-50 p-3 text-sm text-amber-900">Your role requires two-step verification. <NavLink className="underline" to="/security">Set it up now</NavLink>.</p>}<Outlet context={{ platform }} /></main></div></div></div>);
}
export function Home() {
  const { me } = useAuth();
  return (<div><h1 className="mb-4 text-xl font-semibold">Welcome, {me!.user.name}</h1>
    {me!.organizations.length > 0 && <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{me!.organizations.map(o => <NavLink key={o.id + o.via} to={`/org/${o.id}/engagements`} className="card hover:border-brand"><div className="font-semibold">{o.name}</div><div className="text-xs text-slate-500">{o.via === 'staff' ? 'iSecurify assignment' : o.role.replace(/_/g, ' ')}{o.status !== 'active' ? ` · ${o.status}` : ''}</div></NavLink>)}</div>}
    <WidgetGrid platform={me!.user.platformRole !== 'none'} /></div>);
}
