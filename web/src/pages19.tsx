// Storage (Phase 10D): platform storage administration and the per-organization quarantine list.
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api'; import { Empty, ErrorBox, Spinner } from './ui'; import { Badge, Modal, useDo } from './kit'; import { fmtBytes } from './evidenceUi';
import { quotaText, diskText, holdProblem, retentionText } from './storageUi';

function HoldDialog({ org, onClose, onDone }: { org: any; onClose: () => void; onDone: () => void }) {
  const a = useDo(); const [reason, setReason] = useState(''); const problem = holdProblem(reason);
  return (<Modal title={`Legal hold: ${org.name}`} onClose={onClose}><p className="mb-2 text-sm text-slate-600">While a hold is in place, none of this organization's evidence is archived. Nothing is ever deleted.</p>{a.err && <ErrorBox message={a.err} />}
    <label className="block text-sm font-medium text-slate-700">Reason<input className="input mt-1" value={reason} maxLength={300} onChange={e => setReason(e.target.value)} /></label>{reason && problem && <p className="mt-1 text-xs text-red-700">{problem}</p>}
    <div className="mt-3 flex gap-2"><button className="btn" disabled={!!problem || a.busy} onClick={() => a.run(async () => { await api('PUT', `/platform/organizations/${org.id}/legal-hold`, { hold: true, reason: reason.trim() }); onDone(); onClose(); })}>Place hold</button></div></Modal>);
}
function QuotaDialog({ org, onClose, onDone }: { org: any; onClose: () => void; onDone: () => void }) {
  const a = useDo(); const [mb, setMb] = useState(org.quotaIsDefault ? '' : String(Math.round((org.quotaBytes ?? 0) / 1048576)));
  const n = Number(mb); const valid = mb === '' || (Number.isInteger(n) && n >= 1 && n <= 10_485_760);
  return (<Modal title={`Storage limit: ${org.name}`} onClose={onClose}><p className="mb-2 text-sm text-slate-600">Leave empty to use the platform default ({org.defaultText}). A limit only stops new uploads; nothing is removed.</p>{a.err && <ErrorBox message={a.err} />}
    <label className="block text-sm font-medium text-slate-700">Limit in MB<input className="input mt-1" inputMode="numeric" value={mb} onChange={e => setMb(e.target.value.trim())} /></label>{!valid && <p className="mt-1 text-xs text-red-700">Use a whole number of MB, or leave it empty</p>}
    <div className="mt-3"><button className="btn" disabled={!valid || a.busy} onClick={() => a.run(async () => { await api('PUT', `/platform/organizations/${org.id}/evidence-quota`, { quotaMb: mb === '' ? null : n }); onDone(); onClose(); })}>Save</button></div></Modal>);
}
export function StoragePage() {
  const qc = useQueryClient(); const a = useDo(); const [hold, setHold] = useState<any>(null); const [quota, setQuota] = useState<any>(null);
  const q = useQuery({ queryKey: ['storage'], queryFn: () => api<any>('GET', '/platform/storage') }); const refresh = () => qc.invalidateQueries({ queryKey: ['storage'] });
  if (q.isLoading) return <Spinner />; if (q.error || !q.data) return <ErrorBox message="The storage overview could not be loaded." />; const s = q.data;
  const release = (o: any) => a.run(async () => { await api('PUT', `/platform/organizations/${o.id}/legal-hold`, { hold: false }); await refresh(); });
  const releaseEng = (e: any) => a.run(async () => { await api('PUT', `/platform/organizations/${e.tenantId}/engagements/${e.id}/legal-hold`, { hold: false }); await refresh(); });
  const restore = (x: any) => a.run(async () => { await api('POST', `/platform/organizations/${x.tenantId}/engagements/${x.engagementId}/restore-archive`); await refresh(); });
  const defaultText = s.defaults.quotaBytes == null ? 'no limit' : fmtBytes(s.defaults.quotaBytes);
  return (<div className="grid max-w-6xl gap-4"><h1 className="text-xl font-semibold">Storage</h1>{a.err && <ErrorBox message={a.err} />}
    <section className="card text-sm" aria-label="Overview"><p><strong>Disk:</strong> <span className={s.disk?.low ? 'text-red-700' : ''}>{diskText(s.disk)}</span></p>
      <p><strong>Evidence stored:</strong> {fmtBytes(s.totals.usedBytes)} in {s.totals.versionCount} versions. <strong>Default limit per organization:</strong> {defaultText}. <strong>Largest file:</strong> {fmtBytes(s.defaults.maxFileBytes)}.</p>
      <p className="text-slate-500">Evidence is never deleted. After the retention period, closed engagements are archived (kept in full, read-only) unless a legal hold is in place.</p></section>
    <section className="card overflow-x-auto" aria-label="Organizations"><table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-slate-500"><th className="p-1">Organization</th><th>Used</th><th>Limit</th><th>Retention</th><th>Archived</th><th>Flagged files</th><th>Legal hold</th><th /></tr></thead><tbody>
      {s.orgs.map((o: any) => <tr key={o.id} className="border-t"><td className="p-1">{o.name}</td><td>{fmtBytes(o.usedBytes)} <span className="text-xs text-slate-500">({o.versionCount} versions)</span></td><td>{quotaText(o)}</td><td>{retentionText(o.retentionMonths)}</td><td>{o.archivedEngagements || '—'}</td><td>{o.infectedFiles ? <Badge tone="red">{o.infectedFiles}</Badge> : '—'}</td>
        <td>{o.legalHold ? <Badge tone="red" title={o.legalHoldReason ?? ''}>on hold</Badge> : '—'}{o.heldEngagements > 0 && <span className="ml-1 text-xs text-slate-500">+{o.heldEngagements} engagement{o.heldEngagements === 1 ? '' : 's'}</span>}</td>
        <td className="space-x-1 text-right"><button className="btn-secondary" onClick={() => setQuota({ ...o, defaultText })}>Limit</button>{o.legalHold ? <button className="btn-secondary" disabled={a.busy} onClick={() => release(o)}>Release hold</button> : <button className="btn-secondary" onClick={() => setHold(o)}>Legal hold</button>}</td></tr>)}</tbody></table></section>
    <section className="card" aria-label="Held engagements"><h2 className="mb-2 font-semibold">Engagements on legal hold</h2>{!s.heldEngagements.length ? <Empty>None.</Empty> : <ul className="space-y-1 text-sm">{s.heldEngagements.map((e: any) => <li key={e.id} className="flex items-center gap-2">{e.orgName}: {e.name} <span className="text-slate-500">({e.reason})</span><button className="btn-secondary ml-auto" disabled={a.busy} onClick={() => releaseEng(e)}>Release hold</button></li>)}</ul>}</section>
    <section className="card" aria-label="Archived engagements"><h2 className="mb-2 font-semibold">Archived engagements</h2>{!s.archived.length ? <Empty>Nothing has been archived yet.</Empty> : <ul className="space-y-1 text-sm">{s.archived.map((x: any) => <li key={x.engagementId} className="flex items-center gap-2">{x.orgName}: {x.name} <span className="text-slate-500">archived {new Date(x.archivedAt).toLocaleDateString()}, {x.requestCount} evidence requests</span><button className="btn-secondary ml-auto" disabled={a.busy} onClick={() => restore(x)}>Restore</button></li>)}</ul>}</section>
    <section className="card" aria-label="Quarantine"><h2 className="mb-2 font-semibold">Quarantine</h2><Files files={s.quarantine} withOrg /></section>
    {hold && <HoldDialog org={hold} onClose={() => setHold(null)} onDone={refresh} />}{quota && <QuotaDialog org={quota} onClose={() => setQuota(null)} onDone={refresh} />}</div>);
}
function Files({ files, withOrg }: { files: any[]; withOrg?: boolean }) {
  if (!files.length) return <Empty>No file has been flagged by the malware scan.</Empty>;
  return (<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-slate-500">{withOrg && <th className="p-1">Organization</th>}<th className="p-1">File</th><th>Request</th><th>Uploaded by</th><th>Signature</th><th>Found</th></tr></thead><tbody>
    {files.map(f => <tr key={f.versionId} className="border-t">{withOrg && <td className="p-1">{f.orgName}</td>}<td className="p-1">{f.fileName} <span className="text-xs text-slate-500">v{f.versionNo}, {fmtBytes(f.sizeBytes)}</span></td><td>{f.requestTitle}</td><td>{f.uploadedBy}</td><td><Badge tone="red">{f.signature ?? 'unknown'}</Badge></td><td>{f.detectedAt ? new Date(f.detectedAt).toLocaleString() : '—'}</td></tr>)}</tbody></table></div>);
}
export function QuarantinePage() {
  const { tid } = useParams(); const q = useQuery({ queryKey: ['quarantine', tid], queryFn: () => api<{ files: any[] }>('GET', `/t/${tid}/evidence/quarantine`) });
  if (q.isLoading) return <Spinner />; if (q.error || !q.data) return <ErrorBox message="The quarantine list could not be loaded." />;
  return (<div className="max-w-5xl"><h1 className="mb-1 text-xl font-semibold">Quarantine</h1><p className="mb-3 text-sm text-slate-600">Files the malware scan flagged. They cannot be downloaded or accepted. Ask the person to upload a clean file.</p><div className="card"><Files files={q.data.files} /></div></div>);
}
