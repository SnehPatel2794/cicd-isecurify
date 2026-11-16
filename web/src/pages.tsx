import { FormEvent, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { api, ApiError, setCsrf } from './api'; import { useAuth } from './auth'; import { AuthCard, ErrorBox, Field, Spinner } from './ui';

const useAction = () => { const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => { setErr(''); setBusy(true); try { await fn(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Something went wrong'); } finally { setBusy(false); } };
  return { err, busy, run, setErr }; };

export function SetupPage() {
  const nav = useNavigate(); const { refresh } = useAuth(); const a = useAction(); const [f, setF] = useState({ name: '', email: '', password: '' });
  const submit = (e: FormEvent) => { e.preventDefault(); a.run(async () => { await api('POST', '/setup', f); const r = await api('POST', '/auth/login', { email: f.email, password: f.password }); setCsrf(r.csrfToken); await refresh(); nav('/security'); }); };
  return (<AuthCard title="Create the first Super Admin"><form onSubmit={submit}><ErrorBox message={a.err} />
    <Field label="Full name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required />
    <Field label="Email" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} required />
    <Field label="Password (12+ characters, upper, lower, digit)" type="password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} required />
    <button className="btn w-full" disabled={a.busy}>Create account</button></form></AuthCard>);
}
export function LoginPage() {
  const nav = useNavigate(); const { refresh } = useAuth(); const a = useAction(); const [f, setF] = useState({ email: '', password: '' });
  const submit = (e: FormEvent) => { e.preventDefault(); a.run(async () => { const r = await api('POST', '/auth/login', f); setCsrf(r.csrfToken); if (r.mfaRequired) nav('/mfa'); else { await refresh(); nav('/'); } }); };
  return (<AuthCard title="Sign in"><form onSubmit={submit}>{a.err && <ErrorBox message={a.err} />}
    <Field label="Email" type="email" autoComplete="username" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} required />
    <Field label="Password" type="password" autoComplete="current-password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} required />
    <button className="btn w-full" disabled={a.busy}>Sign in</button></form><p className="mt-3 text-sm"><Link className="text-brand underline" to="/reset-password">Forgot password?</Link></p></AuthCard>);
}
export function MfaPage() {
  const nav = useNavigate(); const { refresh } = useAuth(); const a = useAction(); const [code, setCode] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); a.run(async () => { const r = await api('POST', '/auth/mfa/verify', { code: code.trim() }); setCsrf(r.csrfToken); await refresh(); nav('/'); }); };
  return (<AuthCard title="Two-step verification"><form onSubmit={submit}><p className="mb-3 text-sm text-slate-600">Enter the 6-digit code from your authenticator app, or a recovery code.</p>{a.err && <ErrorBox message={a.err} />}
    <Field label="Code" inputMode="text" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} required /><button className="btn w-full" disabled={a.busy}>Verify</button></form></AuthCard>);
}
export function ResetPage() {
  const [sp] = useSearchParams(); const token = sp.get('token'); const a = useAction(); const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [done, setDone] = useState('');
  const request = (e: FormEvent) => { e.preventDefault(); a.run(async () => { await api('POST', '/auth/password/reset-request', { email }); setDone('If that account exists, a reset link has been sent.'); }); };
  const confirm = (e: FormEvent) => { e.preventDefault(); a.run(async () => { await api('POST', '/auth/password/reset', { token, newPassword: pw }); setDone('Password updated. You can now sign in.'); }); };
  return (<AuthCard title="Reset password">{done ? <p className="text-sm">{done} <Link className="text-brand underline" to="/login">Sign in</Link></p> :
    token ? <form onSubmit={confirm}>{a.err && <ErrorBox message={a.err} />}<Field label="New password" type="password" value={pw} onChange={e => setPw(e.target.value)} required /><button className="btn w-full" disabled={a.busy}>Set new password</button></form>
    : <form onSubmit={request}>{a.err && <ErrorBox message={a.err} />}<Field label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} required /><button className="btn w-full" disabled={a.busy}>Send reset link</button></form>}</AuthCard>);
}
function MfaCard() {
  const { me, refresh } = useAuth(); const a = useAction(); const [enrol, setEnrol] = useState<{ secret: string; qr: string } | null>(null); const [code, setCode] = useState(''); const [codes, setCodes] = useState<string[] | null>(null);
  const start = () => a.run(async () => { const r = await api('POST', '/auth/mfa/enroll', {}); setEnrol({ secret: r.secret, qr: await QRCode.toDataURL(r.otpauthUri) }); });
  const confirm = (e: FormEvent) => { e.preventDefault(); a.run(async () => { const r = await api('POST', '/auth/mfa/confirm', { code }); setCodes(r.recoveryCodes); setEnrol(null); await refresh(); }); };
  return (<section className="card"><h2 className="mb-2 font-semibold">Two-step verification</h2>{a.err && <ErrorBox message={a.err} />}
    {codes ? <div><p className="mb-2 text-sm font-medium text-amber-800">Save these recovery codes now. They are shown only once.</p><pre className="rounded bg-slate-100 p-3 text-sm">{codes.join('\n')}</pre></div>
      : me?.mfa.enabled ? <p className="text-sm text-green-700">● Enabled</p>
      : enrol ? <form onSubmit={confirm}><img src={enrol.qr} alt="Scan with your authenticator app" className="mb-2 h-40 w-40" /><p className="mb-2 break-all text-xs">Manual key: {enrol.secret}</p><Field label="6-digit code" value={code} onChange={e => setCode(e.target.value)} required /><button className="btn" disabled={a.busy}>Confirm and enable</button></form>
      : <div><p className="mb-2 text-sm">{me?.mfaEnrollmentRequired ? 'MFA is required for your role before you can continue.' : 'Add a second step to protect your account.'}</p><button className="btn" onClick={start} disabled={a.busy}>Set up authenticator app</button></div>}</section>);
}
function PasswordCard() {
  const a = useAction(); const [f, setF] = useState({ currentPassword: '', newPassword: '' }); const [ok, setOk] = useState(false);
  const submit = (e: FormEvent) => { e.preventDefault(); setOk(false); a.run(async () => { await api('POST', '/auth/password/change', f); setOk(true); setF({ currentPassword: '', newPassword: '' }); }); };
  return (<section className="card"><h2 className="mb-2 font-semibold">Change password</h2><form onSubmit={submit}>{a.err && <ErrorBox message={a.err} />}{ok && <p className="mb-2 text-sm text-green-700">Password changed. Other sessions were signed out.</p>}
    <Field label="Current password" type="password" value={f.currentPassword} onChange={e => setF({ ...f, currentPassword: e.target.value })} required /><Field label="New password" type="password" value={f.newPassword} onChange={e => setF({ ...f, newPassword: e.target.value })} required /><button className="btn" disabled={a.busy}>Update password</button></form></section>);
}
function SessionsCard() {
  const a = useAction(); const q = useQuery({ queryKey: ['sessions'], queryFn: () => api<any[]>('GET', '/auth/sessions') });
  const revoke = () => a.run(async () => { await api('POST', '/auth/sessions/revoke-others', {}); await q.refetch(); });
  return (<section className="card"><h2 className="mb-2 font-semibold">Active sessions</h2>{a.err && <ErrorBox message={a.err} />}{q.isLoading ? <Spinner /> : <ul className="mb-3 text-sm">{q.data?.map(s => <li key={s.id} className="border-b py-1">{s.current ? '● This device' : 'Other device'} · {s.ip} · {new Date(s.created_at).toLocaleString()}</li>)}</ul>}
    <button className="btn-secondary" onClick={revoke} disabled={a.busy}>Sign out other sessions</button></section>);
}
export const SecurityPage = () => (<div className="grid max-w-3xl gap-4"><h1 className="text-xl font-semibold">Account security</h1><MfaCard /><PasswordCard /><SessionsCard /></div>);
