// Certificates (Phase 8B): the organization's certificate list with issue / download / revoke, and the public verification page.
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiBlob, saveBlob } from './api'; import { Empty, ErrorBox, Spinner } from './ui'; import { Badge, Modal, useDo } from './kit';
import { statusTone, statusText, optionKey, readyText, addDays, verifyCodeOf } from './certUi';

function IssueForm({ tid, onDone }: { tid: string; onDone: () => void }) {
  const a = useDo(); const q = useQuery({ queryKey: ['cert-eligible', tid], queryFn: () => api<any>('GET', `/t/${tid}/certificates/eligible`) });
  const [sel, setSel] = useState(''); const [scope, setScope] = useState(''); const [until, setUntil] = useState(addDays(new Date().toISOString().slice(0, 10), 365)); const [why, setWhy] = useState('');
  if (q.isLoading) return <Spinner />; const opts: any[] = q.data?.options ?? []; const o = opts.find(x => optionKey(x) === sel);
  return (<form className="space-y-3" onSubmit={e => { e.preventDefault(); if (!o) return; a.run(async () => { await api('POST', `/t/${tid}/certificates`, { engagementId: o.engagementId, frameworkId: o.frameworkId, scope, validUntil: until, overrideReason: o.ready ? undefined : why }); onDone(); }); }}>
    {!opts.length ? <Empty>No closed engagements yet. A certificate can be issued once an engagement is closed.</Empty> : <>
      <label className="block text-sm font-medium">Engagement and framework<select className="input" value={sel} onChange={e => setSel(e.target.value)} required><option value="">Select…</option>{opts.map(x => <option key={optionKey(x)} value={optionKey(x)}>{x.engagementName} — {x.frameworkName} ({readyText(x)})</option>)}</select></label>
      <label className="block text-sm font-medium">Scope of the certificate<textarea className="input" rows={3} minLength={10} maxLength={2000} value={scope} onChange={e => setScope(e.target.value)} required /></label>
      <label className="block text-sm font-medium">Valid until<input className="input" type="date" value={until} onChange={e => setUntil(e.target.value)} required /></label>
      {o && !o.ready && <label className="block text-sm font-medium">Reason for issuing although not every control is effective<textarea className="input" rows={2} minLength={10} value={why} onChange={e => setWhy(e.target.value)} required /><span className="text-xs text-amber-700">{readyText(o)}. The reason is stored with the certificate.</span></label>}
      {a.err && <ErrorBox message={a.err} />}<button className="btn" disabled={a.busy || !o}>Issue certificate</button></>}
  </form>);
}
function RevokeForm({ tid, c, onDone }: { tid: string; c: any; onDone: () => void }) {
  const a = useDo(); const [reason, setReason] = useState('');
  return (<form className="space-y-3" onSubmit={e => { e.preventDefault(); a.run(async () => { await api('POST', `/t/${tid}/certificates/${c.id}/revoke`, { reason }); onDone(); }); }}>
    <p className="text-sm">Revoking <b>{c.number}</b> cannot be undone. Anyone checking it will see that it was revoked (the reason is not shown to them).</p>
    <label className="block text-sm font-medium">Reason<textarea className="input" rows={3} minLength={3} value={reason} onChange={e => setReason(e.target.value)} required /></label>
    {a.err && <ErrorBox message={a.err} />}<button className="btn bg-red-700" disabled={a.busy}>Revoke certificate</button></form>);
}
export function CertificatesPage() {
  const { tid } = useParams(); const t = tid!; const qc = useQueryClient(); const a = useDo(); const [dlg, setDlg] = useState<null | 'issue' | { revoke: any }>(null);
  const q = useQuery({ queryKey: ['certs', t], queryFn: () => api<any>('GET', `/t/${t}/certificates`) });
  const done = () => { setDlg(null); qc.invalidateQueries({ queryKey: ['certs', t] }); qc.invalidateQueries({ queryKey: ['cert-eligible', t] }); };
  const dl = (c: any) => a.run(async () => saveBlob(await apiBlob(`/t/${t}/certificates/${c.id}/pdf`), `${c.number}.pdf`));
  if (q.isLoading) return <Spinner />; if (q.error) return <ErrorBox message="Certificates could not be loaded." />; const d = q.data; const s = d.summary;
  return (<div className="space-y-4"><div className="flex items-center"><h1 className="text-xl font-semibold">Certificates</h1>{d.can.issue && <button className="btn ml-auto" onClick={() => setDlg('issue')}>Issue certificate</button>}</div>
    <p className="text-sm text-slate-600" aria-label="Summary">{s.valid} valid · {s.expiringSoon} expiring soon · {s.expired} expired · {s.revoked} revoked · {s.superseded} superseded</p>{a.err && <ErrorBox message={a.err} />}
    {!d.certificates.length ? <Empty>No certificates yet.</Empty> : <div className="card overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-slate-500"><th>Number</th><th>Framework</th><th>Engagement</th><th>Valid</th><th>Status</th><th /></tr></thead><tbody>
      {d.certificates.map((c: any) => (<tr key={c.id} className="border-t"><td className="py-2 font-mono">{c.number}{c.opinion === 'qualified' && <> <span className="rounded bg-amber-100 px-1.5 py-0.5 font-sans text-xs text-amber-800">qualified</span></>}</td><td>{c.frameworkName} <span className="text-xs text-slate-500">v{c.frameworkVersion}</span></td><td>{c.engagementName}</td><td>{c.issuedOn} → {c.validUntil}</td>
        <td><Badge tone={statusTone(c.status, c.expiringSoon)}>{statusText(c)}</Badge>{c.overridden && <Badge tone="amber" title={c.overrideReason}>Issued with override</Badge>}</td>
        <td className="space-x-2 text-right">{c.status !== 'revoked' && <button className="btn-secondary" aria-label={`Download ${c.number}`} onClick={() => dl(c)}>PDF</button>}{d.can.revoke && c.status !== 'revoked' && <button className="btn-secondary" aria-label={`Revoke ${c.number}`} onClick={() => setDlg({ revoke: c })}>Revoke</button>}</td></tr>))}</tbody></table></div>}
    {dlg === 'issue' && <Modal title="Issue certificate" onClose={() => setDlg(null)}><IssueForm tid={t} onDone={done} /></Modal>}
    {dlg && dlg !== 'issue' && <Modal title="Revoke certificate" onClose={() => setDlg(null)}><RevokeForm tid={t} c={dlg.revoke} onDone={done} /></Modal>}</div>);
}
/** Public page: anyone with the link or QR code can check a certificate. No sign-in, nothing but the minimum is shown. */
export function VerifyPage() {
  const { code } = useParams(); const ok = verifyCodeOf(code ?? '');
  const q = useQuery({ queryKey: ['verify', code], enabled: !!ok, retry: false, queryFn: () => api<any>('GET', `/public/certificates/${code}`) });
  const box = 'mx-auto mt-10 max-w-xl rounded-lg border bg-white p-6 shadow-sm';
  if (!ok || q.isError) return <main className={box}><h1 className="text-xl font-semibold">Certificate not found</h1><p className="mt-2 text-sm text-slate-600">We could not find a certificate for this link. Check that the address was copied completely.</p></main>;
  if (q.isLoading) return <main className={box}><Spinner /></main>; const c = q.data;
  return (<main className={box}><p className={`rounded p-3 text-lg font-semibold ${c.valid ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`} role="status">{c.valid ? 'This certificate is valid' : `This certificate is ${c.status}`}</p>
    <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-2 text-sm"><dt className="text-slate-500">Number</dt><dd className="font-mono">{c.number}</dd><dt className="text-slate-500">Organization</dt><dd>{c.organization}</dd><dt className="text-slate-500">Framework</dt><dd>{c.framework}</dd><dt className="text-slate-500">Scope</dt><dd>{c.scope}</dd><dt className="text-slate-500">Issued</dt><dd>{c.issuedOn}</dd><dt className="text-slate-500">Valid until</dt><dd>{c.validUntil}</dd><dt className="text-slate-500">Issued by</dt><dd>{c.issuer}</dd>{c.auditorOpinion && <><dt className="text-slate-500">Auditor opinion</dt><dd>{c.auditorOpinion}</dd></>}</dl></main>);
}
