import { StoragePanel } from './pages5'; import { FormEvent, ReactNode, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiBlob, saveBlob, ApiError } from './api'; import { WipeDialog } from './pages27'; import { useAuth } from './auth'; import { Empty, ErrorBox, Field, Spinner, AuthCard } from './ui'; import { ROLE_LABEL, rolesFor, platformRolesFor, CLIENT_ROLES } from './roles';

const msg = (e: unknown) => e instanceof ApiError ? e.message : 'Something went wrong';
function useDo() { const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [note, setNote] = useState('');
  const run = async (fn: () => Promise<unknown>, ok = '') => { setErr(''); setNote(''); setBusy(true); try { await fn(); setNote(ok); } catch (e) { setErr(msg(e)); } finally { setBusy(false); } };
  return { err, busy, note, run }; }
const Select = ({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: readonly string[]; label: string }) => (
  <select aria-label={label} className="rounded border px-2 py-1 text-sm" value={value} onChange={e => onChange(e.target.value)}>{options.map(o => <option key={o} value={o}>{ROLE_LABEL[o] ?? o}</option>)}</select>);
const Th = ({ children }: { children?: ReactNode }) => <th className="px-2 py-1 text-left text-xs font-semibold uppercase text-slate-500">{children}</th>;
const Badge = ({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red' }) => <span className={`rounded px-1.5 py-0.5 text-xs ${{ slate: 'bg-slate-100 text-slate-700', green: 'bg-green-100 text-green-800', amber: 'bg-amber-100 text-amber-800', red: 'bg-red-100 text-red-800' }[tone]}`}>{children}</span>;

// ---------------- invitations ----------------
export function AcceptInvitePage() {
  const [sp] = useSearchParams(); const token = sp.get('token') ?? ''; const { me } = useAuth(); const a = useDo(); const [f, setF] = useState({ name: '', password: '' }); const [done, setDone] = useState(false);
  const q = useQuery({ queryKey: ['invite', token], queryFn: () => api<any>('GET', `/invitations/${token}`), retry: false });
  const submit = (e: FormEvent) => { e.preventDefault(); a.run(async () => { await api('POST', `/invitations/${token}/accept`, q.data.accountExists ? {} : f); setDone(true); }); };
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <AuthCard title="Invitation"><ErrorBox message="This invitation is invalid, expired or already used." /><Link className="text-brand underline" to="/login">Go to sign in</Link></AuthCard>;
  const inv = q.data;
  return (<AuthCard title={inv.organization ? `Join ${inv.organization}` : 'Join iSecurify'}>
    {done ? <p className="text-sm">Done. <Link className="text-brand underline" to="/login">Sign in</Link> to continue.</p> :
      <form onSubmit={submit}><p className="mb-3 text-sm text-slate-600">You were invited as <b>{ROLE_LABEL[inv.role] ?? inv.role}</b> ({inv.email}).</p>{a.err && <ErrorBox message={a.err} />}
        {inv.accountExists ? (me ? <button className="btn w-full" disabled={a.busy}>Accept invitation</button> : <p className="text-sm">An account with this email exists. <Link className="text-brand underline" to="/login">Sign in</Link>, then open this link again.</p>)
          : <><Field label="Full name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required /><Field label="Password (12+ characters, upper, lower, digit)" type="password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} required /><button className="btn w-full" disabled={a.busy}>Create account</button></>}</form>}</AuthCard>);
}

// ---------------- audit table (used by tenant and platform pages) ----------------
export function AuditTable({ base }: { base: string }) {
  const [action, setAction] = useState(''); const [before, setBefore] = useState<number[]>([]);
  const cursor = before[before.length - 1]; const qs = new URLSearchParams({ limit: '25', ...(action ? { action } : {}), ...(cursor ? { beforeId: String(cursor) } : {}) });
  const q = useQuery({ queryKey: ['audit', base, action, cursor], queryFn: () => api<any>('GET', `${base}?${qs}`) });
  return (<section className="card"><div className="mb-2 flex items-center gap-2"><h2 className="font-semibold">Audit log</h2>
    {(q.data?.actions?.length ?? 0) > 0 && <select aria-label="Filter by action" className="rounded border px-2 py-1 text-sm" value={action} onChange={e => { setAction(e.target.value); setBefore([]); }}><option value="">All actions</option>{(q.data?.actions ?? []).map((a: string) => <option key={a}>{a}</option>)}</select>}</div>
    {q.isLoading ? <Spinner /> : q.isError ? <ErrorBox message={msg(q.error)} /> : !q.data.items.length ? <Empty>No audit entries.</Empty> :
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Detail</Th></tr></thead><tbody>{q.data.items.map((e: any) => (
        <tr key={e.id} className="border-t"><td className="px-2 py-1 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td><td className="px-2 py-1">{e.actor_name ?? '—'}</td><td className="px-2 py-1"><Badge>{e.action}</Badge></td><td className="px-2 py-1 text-xs text-slate-600">{e.detail ? JSON.stringify(typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail).slice(0, 120) : ''}</td></tr>))}</tbody></table></div>}
    <div className="mt-2 flex gap-2"><button className="btn-secondary" disabled={!before.length} onClick={() => setBefore(b => b.slice(0, -1))}>Newer</button><button className="btn-secondary" disabled={!q.data?.nextBeforeId} onClick={() => setBefore(b => [...b, q.data.nextBeforeId])}>Older</button></div></section>);
}
export const PlatformAuditPage = () => (<div className="grid gap-4"><h1 className="text-xl font-semibold">Platform audit log</h1><AuditTable base="/platform/audit" /></div>);

// ---------------- tenant workspace ----------------
function InviteForm({ url, roles, onDone }: { url: string; roles: readonly string[]; onDone: () => void }) {
  const a = useDo(); const [email, setEmail] = useState(''); const [role, setRole] = useState(roles[0]);
  const submit = (e: FormEvent) => { e.preventDefault(); a.run(async () => { await api('POST', url, { email, role }); setEmail(''); onDone(); }, 'Invitation sent.'); };
  return (<form onSubmit={submit} className="flex flex-wrap items-end gap-2"><div className="min-w-[14rem]"><Field label="Invite by email" type="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
    <div className="mb-3"><Select label="Role" value={role} onChange={setRole} options={roles} /></div><button className="btn mb-3" disabled={a.busy}>Send invitation</button>
    {a.err && <div className="w-full"><ErrorBox message={a.err} /></div>}{a.note && <p className="mb-3 w-full text-sm text-green-700">{a.note}</p>}</form>);
}
export function OrgPage() {
  const { id } = useParams(); const { me } = useAuth(); const qc = useQueryClient(); const a = useDo(); const [tab, setTab] = useState<'members' | 'invites' | 'audit'>('members');
  const org = me?.organizations.find(o => o.id === id); const mine = org?.role ?? '';
  const members = useQuery({ queryKey: ['members', id], queryFn: () => api<any[]>('GET', `/t/${id}/members`), retry: false });
  const invites = useQuery({ queryKey: ['invites', id], queryFn: () => api<any[]>('GET', `/t/${id}/invitations`), retry: false, enabled: tab === 'invites' });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['members', id] }); qc.invalidateQueries({ queryKey: ['invites', id] }); };
  if (!org) return <ErrorBox message="You do not have access to this organization." />;
  const forbidden = members.error instanceof ApiError && members.error.status === 403;
  const Tab = ({ k, children }: { k: typeof tab; children: ReactNode }) => <button onClick={() => setTab(k)} className={`rounded px-3 py-1 text-sm ${tab === k ? 'bg-brand text-white' : 'bg-white border'}`}>{children}</button>;
  return (<div className="grid gap-4"><div><h1 className="text-xl font-semibold">{org.name}</h1><p className="text-sm text-slate-500">Your access: {ROLE_LABEL[mine] ?? mine}{org.status !== 'active' && <> · <Badge tone="amber">{org.status}</Badge></>}</p></div>
    {forbidden ? <div className="card text-sm">Your role does not include managing people in this organization. Evidence, checklists and reports arrive in later phases.</div> : <>
      <div className="flex gap-2"><Tab k="members">Members</Tab><Tab k="invites">Invitations</Tab><Tab k="audit">Audit log</Tab></div>
      {a.err && <ErrorBox message={a.err} />}
      {tab === 'members' && <section className="card"><h2 className="mb-2 font-semibold">Members</h2>{members.isLoading ? <Spinner /> : members.isError ? <ErrorBox message={msg(members.error)} /> : !members.data!.length ? <Empty>No members yet.</Empty> :
        <table className="w-full text-sm"><thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th /></tr></thead><tbody>{members.data!.map(m => (<tr key={m.id} className="border-t"><td className="px-2 py-1">{m.name}{m.status !== 'active' && <> <Badge tone="red">{m.status}</Badge></>}</td><td className="px-2 py-1">{m.email}</td>
          <td className="px-2 py-1"><Select label={`Role of ${m.name}`} value={m.role} options={CLIENT_ROLES} onChange={role => a.run(async () => { await api('PATCH', `/t/${id}/members/${m.id}`, { role }); refresh(); })} /></td>
          <td className="px-2 py-1 text-right"><button className="btn-secondary" onClick={() => confirm(`Remove ${m.name} from ${org.name}?`) && a.run(async () => { await api('DELETE', `/t/${id}/members/${m.id}`); refresh(); })}>Remove</button></td></tr>))}</tbody></table>}</section>}
      {tab === 'invites' && <section className="card"><h2 className="mb-2 font-semibold">Invitations</h2><InviteForm url={`/t/${id}/invitations`} roles={rolesFor(mine)} onDone={refresh} />
        {invites.isLoading ? <Spinner /> : !invites.data?.length ? <Empty>No pending invitations.</Empty> : <table className="w-full text-sm"><tbody>{invites.data.map(i => <tr key={i.id} className="border-t"><td className="px-2 py-1">{i.email}</td><td className="px-2 py-1">{ROLE_LABEL[i.role]}</td><td className="px-2 py-1 text-xs">expires {new Date(i.expires_at).toLocaleDateString()}</td>
          <td className="px-2 py-1 text-right"><button className="btn-secondary" onClick={() => a.run(async () => { await api('DELETE', `/t/${id}/invitations/${i.id}`); refresh(); })}>Revoke</button></td></tr>)}</tbody></table>}</section>}
      {tab === 'audit' && <AuditTable base={`/t/${id}/audit`} />}</>}</div>);
}

// ---------------- platform: organizations ----------------
function StaffPanel({ org }: { org: any }) {
  const qc = useQueryClient(); const a = useDo(); const staff = useQuery({ queryKey: ['staff', org.id], queryFn: () => api<any[]>('GET', `/platform/organizations/${org.id}/staff`) });
  const users = useQuery({ queryKey: ['platform-users'], queryFn: () => api<any[]>('GET', '/platform/users') });
  const [f, setF] = useState({ userId: '', canManage: true, canReadEvidence: false, expiresAt: '' }); const refresh = () => qc.invalidateQueries({ queryKey: ['staff', org.id] });
  const team = (users.data ?? []).filter(u => u.platformRole !== 'none' && u.status === 'active');
  const submit = (e: FormEvent) => { e.preventDefault(); a.run(async () => { await api('POST', `/platform/organizations/${org.id}/staff`, { userId: f.userId, canManage: f.canManage, canReadEvidence: f.canReadEvidence, expiresAt: f.expiresAt ? new Date(f.expiresAt).toISOString() : null }); refresh(); }); };
  return (<div className="mt-2 rounded bg-slate-50 p-3 text-sm"><b>iSecurify staff assigned to {org.name}</b>
    {staff.isLoading ? <Spinner /> : !staff.data?.length ? <Empty>Nobody is assigned. Without an assignment, iSecurify staff cannot see this customer's data.</Empty> : <ul className="my-2">{staff.data.map(s => <li key={s.id} className="flex items-center gap-2 border-b py-1">{s.name} <Badge>{s.can_manage ? 'manage' : 'view'}</Badge>{s.can_read_evidence && <Badge tone="amber">evidence</Badge>}<span className="text-xs text-slate-500">{s.expires_at ? `until ${new Date(s.expires_at).toLocaleString()}` : 'no expiry'}</span>
      <button className="ml-auto underline" onClick={() => a.run(async () => { await api('DELETE', `/platform/organizations/${org.id}/staff/${s.id}`); refresh(); })}>Revoke</button></li>)}</ul>}
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2"><label className="text-xs">Person<select className="input" value={f.userId} onChange={e => setF({ ...f, userId: e.target.value })} required><option value="">Select…</option>{team.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      <label className="text-xs">Expires<input type="datetime-local" className="input" value={f.expiresAt} onChange={e => setF({ ...f, expiresAt: e.target.value })} /></label>
      <label className="mb-3 text-xs"><input type="checkbox" checked={f.canManage} onChange={e => setF({ ...f, canManage: e.target.checked })} /> can manage</label>
      <label className="mb-3 text-xs"><input type="checkbox" checked={f.canReadEvidence} onChange={e => setF({ ...f, canReadEvidence: e.target.checked })} /> can read evidence</label><button className="btn mb-3" disabled={a.busy}>Assign</button></form>{a.err && <ErrorBox message={a.err} />}</div>);
}
export function OrganizationsPage() {
  const qc = useQueryClient(); const { me } = useAuth(); const a = useDo(); const [name, setName] = useState(''); const [isDemo, setIsDemo] = useState(false); const [wipe, setWipe] = useState<any>(null); const [open, setOpen] = useState<string | null>(null); const [inv, setInv] = useState<string | null>(null); const [store, setStore] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['orgs'], queryFn: () => api<any[]>('GET', '/platform/organizations') }); const refresh = () => { qc.invalidateQueries({ queryKey: ['orgs'] }); qc.invalidateQueries({ queryKey: ['me'] }); };
  const create = (e: FormEvent) => { e.preventDefault(); a.run(async () => { await api('POST', '/platform/organizations', { name, isDemo }); setName(''); setIsDemo(false); refresh(); }); };
  const tone = (s: string) => s === 'active' ? 'green' : s === 'suspended' ? 'amber' : 'red';
  return (<div className="grid gap-4"><h1 className="text-xl font-semibold">Client organizations</h1>
    <form onSubmit={create} className="card flex items-end gap-2"><div className="flex-1"><Field label="New client organization" value={name} onChange={e => setName(e.target.value)} required /></div><label className="mb-3 flex items-center gap-1 text-xs" title="Demo organizations can be wiped completely later. This cannot be changed afterwards."><input type="checkbox" checked={isDemo} onChange={e => setIsDemo(e.target.checked)} />Demo / test data</label><button className="btn mb-3" disabled={a.busy}>Create</button></form>{a.err && <ErrorBox message={a.err} />}
    {q.isLoading ? <Spinner /> : q.isError ? <ErrorBox message={msg(q.error)} /> : !q.data!.length ? <Empty>No client organizations yet.</Empty> : q.data!.map(o => (
      <section key={o.id} className="card"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{o.name}</h2><Badge tone={tone(o.status)}>{o.status}</Badge>{o.isDemo && <Badge tone="amber">demo</Badge>}<span className="text-xs text-slate-500">{o.memberCount} members</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {o.status === 'active' ? <button className="btn-secondary" onClick={() => a.run(async () => { await api('PATCH', `/platform/organizations/${o.id}`, { status: 'suspended' }); refresh(); })}>Suspend</button> : o.status === 'suspended' ? <button className="btn-secondary" onClick={() => a.run(async () => { await api('PATCH', `/platform/organizations/${o.id}`, { status: 'active' }); refresh(); })}>Reactivate</button> : null}
          {me?.user.platformRole === 'super_admin' && o.status !== 'archived' && <button className="btn-secondary" onClick={() => confirm(`Archive ${o.name}? Only a Super Admin can restore it.`) && a.run(async () => { await api('PATCH', `/platform/organizations/${o.id}`, { status: 'archived' }); refresh(); })}>Archive</button>}
          <button className="btn-secondary" onClick={() => setInv(inv === o.id ? null : o.id)}>Invite</button><button className="btn-secondary" onClick={() => setOpen(open === o.id ? null : o.id)}>Staff access</button><button className="btn-secondary" onClick={() => setStore(store === o.id ? null : o.id)}>Storage</button>{me?.user.platformRole === 'super_admin' && o.isDemo && <button className="btn-secondary text-red-700" onClick={() => setWipe(o)}>Wipe demo data</button>}</div></div>
        {inv === o.id && <div className="mt-2"><InviteForm url={`/platform/organizations/${o.id}/invitations`} roles={CLIENT_ROLES} onDone={refresh} /></div>}{open === o.id && <StaffPanel org={o} />}{store === o.id && <StoragePanel orgId={o.id} canEdit />}</section>))}{wipe && <WipeDialog org={wipe} onClose={() => setWipe(null)} onDone={() => { setWipe(null); refresh(); qc.invalidateQueries({ queryKey: ['portfolio'] }); }} />}</div>);
}

// ---------------- platform: users ----------------
function DeleteDialog({ user, onClose, onDone }: { user: any; onClose: () => void; onDone: () => void }) {
  const a = useDo(); const [backup, setBackup] = useState(false); const [confirmEmail, setConfirmEmail] = useState(''); const [reason, setReason] = useState('');
  const s = useQuery({ queryKey: ['del-summary', user.id], queryFn: () => api<any>('GET', `/platform/users/${user.id}/deletion-summary`), gcTime: 0 });
  const download = () => a.run(async () => { saveBlob(await apiBlob(`/platform/users/${user.id}/backup`), `account-backup-${user.id.slice(0, 8)}.pdf`); setBackup(true); });
  const del = (withoutBackup: boolean) => a.run(async () => { await api('POST', `/platform/users/${user.id}/delete`, { reason: reason || undefined, ...(withoutBackup ? { withoutBackup: true, confirmEmail } : {}) }); onDone(); });
  return (<div role="dialog" aria-label="Delete user" className="fixed inset-0 z-10 grid place-items-center bg-black/40 p-4"><div className="card max-h-[90vh] w-full max-w-lg overflow-auto"><h2 className="mb-2 text-lg font-semibold">Delete {user.name}</h2>
    {s.isLoading ? <Spinner /> : s.isError ? <ErrorBox message={msg(s.error)} /> : <>
      <p className="mb-2 text-sm">The account is anonymised and can no longer sign in. Their evidence, comments and audit history stay on record.</p>
      <p className="mb-2 text-sm">Member of {s.data.memberships.length} organization(s); {s.data.auditEvents} audit entries.</p>
      {s.data.blockers.length > 0 && <div className="mb-3 rounded bg-red-50 p-2 text-sm text-red-800"><b>Reassign these open items first:</b><ul className="list-disc pl-5">{s.data.blockers.map((b: any) => <li key={b.id}>{b.label}</li>)}</ul></div>}
      {a.err && <ErrorBox message={a.err} />}
      {s.data.canDelete && <><Field label="Reason (optional)" value={reason} onChange={e => setReason(e.target.value)} />
        <div className="mb-3 flex flex-wrap gap-2"><button className="btn-secondary" onClick={download} disabled={a.busy}>1. Download account backup (PDF)</button><button className="btn" disabled={!backup || a.busy} onClick={() => del(false)}>2. Delete user</button></div>
        <details className="text-sm"><summary className="cursor-pointer text-slate-600">Delete without a backup</summary><Field label={`Type ${user.email} to confirm`} value={confirmEmail} onChange={e => setConfirmEmail(e.target.value)} /><button className="btn-secondary" disabled={confirmEmail.toLowerCase() !== user.email.toLowerCase() || a.busy} onClick={() => del(true)}>Delete without backup</button></details></>}</>}
    <div className="mt-3 text-right"><button className="btn-secondary" onClick={onClose}>Close</button></div></div></div>);
}
export function UsersPage() {
  const qc = useQueryClient(); const { me } = useAuth(); const a = useDo(); const [search, setSearch] = useState(''); const [del, setDel] = useState<any>(null);
  const q = useQuery({ queryKey: ['platform-users', search], queryFn: () => api<any[]>('GET', `/platform/users${search ? `?q=${encodeURIComponent(search)}` : ''}`) }); const refresh = () => qc.invalidateQueries({ queryKey: ['platform-users'] });
  const mine = me!.user.platformRole; const grantable = platformRolesFor(mine); const [inv, setInv] = useState({ email: '', platformRole: grantable[0] ?? 'isecurify_team' });
  const invite = (e: FormEvent) => { e.preventDefault(); a.run(async () => { await api('POST', '/platform/users', inv); setInv({ ...inv, email: '' }); refresh(); }, 'Invitation sent.'); };
  const canTouch = (u: any) => u.id !== me!.user.id && (mine === 'super_admin' || (mine === 'admin' && ['none', 'isecurify_team'].includes(u.platformRole)));
  return (<div className="grid gap-4"><h1 className="text-xl font-semibold">Users</h1>
    <form onSubmit={invite} className="card flex flex-wrap items-end gap-2"><div className="min-w-[14rem] flex-1"><Field label="Invite an iSecurify user" type="email" value={inv.email} onChange={e => setInv({ ...inv, email: e.target.value })} required /></div>
      <div className="mb-3"><Select label="Platform role" value={inv.platformRole} onChange={platformRole => setInv({ ...inv, platformRole })} options={grantable} /></div><button className="btn mb-3" disabled={a.busy}>Send invitation</button></form>
    {a.err && <ErrorBox message={a.err} />}{a.note && <p className="text-sm text-green-700">{a.note}</p>}
    <input aria-label="Search users" placeholder="Search name or email" className="input max-w-sm" value={search} onChange={e => setSearch(e.target.value)} />
    {q.isLoading ? <Spinner /> : q.isError ? <ErrorBox message={msg(q.error)} /> : !q.data!.length ? <Empty>No users found.</Empty> :
      <div className="card overflow-x-auto"><table className="w-full text-sm"><thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th>Orgs</Th><Th /></tr></thead><tbody>{q.data!.map(u => (<tr key={u.id} className="border-t"><td className="px-2 py-1">{u.name}</td><td className="px-2 py-1">{u.email}</td>
        <td className="px-2 py-1">{u.platformRole !== 'none' && canTouch(u) ? <Select label={`Role of ${u.name}`} value={u.platformRole} options={platformRolesFor(mine).includes(u.platformRole) ? platformRolesFor(mine) : [u.platformRole, ...platformRolesFor(mine)]} onChange={platformRole => a.run(async () => { await api('PATCH', `/platform/users/${u.id}`, { platformRole }); refresh(); })} /> : ROLE_LABEL[u.platformRole]}</td>
        <td className="px-2 py-1"><Badge tone={u.status === 'active' ? 'green' : 'red'}>{u.status}</Badge></td><td className="px-2 py-1">{u.orgCount}</td>
        <td className="px-2 py-1 text-right whitespace-nowrap">{canTouch(u) && <><button className="btn-secondary mr-2" onClick={() => a.run(async () => { await api('PATCH', `/platform/users/${u.id}`, { status: u.status === 'active' ? 'disabled' : 'active' }); refresh(); })}>{u.status === 'active' ? 'Disable' : 'Enable'}</button><button className="btn-secondary" onClick={() => setDel(u)}>Delete…</button></>}</td></tr>))}</tbody></table></div>}
    {del && <DeleteDialog user={del} onClose={() => setDel(null)} onDone={() => { setDel(null); refresh(); }} />}</div>);
}
