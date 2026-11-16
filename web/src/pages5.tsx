// Evidence screens (Phase 5B): the engagement Evidence tab and the per-item evidence drawer.
import { FormEvent, useRef, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api, apiBlob, apiUpload, saveBlob } from './api'; import { Empty, ErrorBox, Field, Spinner } from './ui'; import { Badge, Modal, useDo } from './kit';
import { TemplateLink, TemplatePicker } from './pages6';
import { ITEM_EVIDENCE_LABEL, ITEM_EVIDENCE_TONE, REQUEST_LABEL, SCAN_LABEL, checkPick, fmtBytes, requestLabel, requestTone, sha256Hex, shortHash, usagePercent, usageTone } from './evidenceUi';

export const EvidenceStatusBadge = ({ status }: { status: string }) => <Badge tone={ITEM_EVIDENCE_TONE[status] ?? 'slate'}>{ITEM_EVIDENCE_LABEL[status] ?? status}</Badge>;
const when = (v: string | Date | null | undefined) => v ? new Date(v).toISOString().slice(0, 16).replace('T', ' ') : '—';
const useConfig = (tid: string) => useQuery({ queryKey: ['evidence-config', tid], queryFn: () => api<any>('GET', `/t/${tid}/evidence/config`) });

export function UsageBar({ usage }: { usage: { usedBytes: number; quotaBytes: number | null } }) {
  if (usage.quotaBytes == null) return <div className="text-xs text-slate-600" aria-label="Evidence storage">{fmtBytes(usage.usedBytes)} used · no limit</div>;
  const pct = usagePercent(usage.usedBytes, usage.quotaBytes); const tone = usageTone(pct);
  return (<div className="text-xs text-slate-600" aria-label="Evidence storage"><div className="h-2 w-40 rounded bg-slate-100" role="img" aria-label={`Storage ${pct}% used`}><div className={`h-2 rounded ${tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-brand'}`} style={{ width: `${pct}%` }} /></div>{fmtBytes(usage.usedBytes)} of {fmtBytes(usage.quotaBytes)} used</div>);
}

// ---------------------------------------------------------------- engagement Evidence tab
export function EvidenceTab({ tid, eid, d, refresh }: any) {
  const p = d.permissions; const closed = d.status === 'closed'; const [status, setStatus] = useState(''); const [drawer, setDrawer] = useState<string | null>(null); const [bulk, setBulk] = useState(false);
  const q = useQuery({ queryKey: ['evidence', tid, eid, status], queryFn: () => api<any>('GET', `/t/${tid}/engagements/${eid}/evidence${status ? `?status=${status}` : ''}`), placeholderData: keepPreviousData }); const cfg = useConfig(tid);
  if (q.isLoading) return <Spinner />; if (q.isError) return <ErrorBox message="Could not load evidence" />;
  const s = q.data.summary; const chips: [string, number, 'red' | 'amber' | undefined][] = [['Requested', s.requested, undefined], ['Awaiting review', s.submitted, undefined], ['Accepted', s.accepted, undefined], ['Rejected', s.rejected, s.rejected ? 'red' : undefined], ['Expired', s.expired, s.expired ? 'amber' : undefined], ['Overdue', s.overdue, s.overdue ? 'red' : undefined]];
  return (<div className="grid gap-3">
    <div className="flex flex-wrap items-center gap-3">{chips.map(([l, n, t]) => <div key={l} className="card px-3 py-2"><div className="text-xs uppercase text-slate-500">{l}</div><div className={`text-xl font-semibold ${t === 'red' ? 'text-red-700' : t === 'amber' ? 'text-amber-700' : ''}`}>{n}</div></div>)}
      <div className="ml-auto flex flex-col items-end gap-2">{cfg.data && <UsageBar usage={cfg.data.usage} />}{p.manage && !closed && <button className="btn" onClick={() => setBulk(true)}>Request evidence for items…</button>}</div></div>
    <div className="flex items-center gap-2"><select aria-label="Filter by request status" className="rounded border px-2 py-1 text-sm" value={status} onChange={e => setStatus(e.target.value)}><option value="">All requests</option>{Object.entries(REQUEST_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select><span className="text-xs text-slate-500">{q.data.requests.length} request(s){q.data.truncated ? ' (first 2000 shown)' : ''}</span></div>
    {!q.data.requests.length ? <Empty>No evidence requests{status ? ' with this status' : ' yet'}.</Empty> : (<section className="card overflow-x-auto"><table className="w-full min-w-[60rem] text-sm"><thead><tr className="text-left text-xs uppercase text-slate-500"><th className="p-1">Control</th><th>Request</th><th>Status</th><th>Latest version</th><th>Due</th><th /></tr></thead><tbody>
      {q.data.requests.map((r: any) => (<tr key={r.id} className="border-t align-top"><td className="w-24 p-1 font-mono text-xs">{r.itemRef}</td><td className="pr-2">{r.title}<div className="text-xs text-slate-500">{r.itemTitle}</div></td>
        <td><Badge tone={requestTone(r)}>{requestLabel(r)}</Badge>{r.overdue && <> <Badge tone="red">overdue</Badge></>}{r.validUntil && <div className="text-xs text-slate-500">valid until {r.validUntil}</div>}</td>
        <td>{r.latest ? (<div className="text-xs"><div>v{r.latest.versionNo} · {r.latest.kind === 'file' ? `${r.latest.fileName} (${fmtBytes(r.latest.sizeBytes)})` : `link${r.latest.provider ? ` (${r.latest.provider.replace('_', ' ')})` : ''}`}</div><div className="text-slate-500">{r.latest.uploadedByName} · {when(r.latest.uploadedAt)}</div>{r.latest.kind === 'file' && <Badge tone={SCAN_LABEL[r.latest.scanStatus]?.[1]}>{SCAN_LABEL[r.latest.scanStatus]?.[0]}</Badge>}</div>) : <span className="text-xs text-slate-500">Nothing submitted</span>}</td>
        <td>{r.dueDate ?? '—'}</td><td className="text-right"><button className="btn-secondary" onClick={() => setDrawer(r.itemId)}>{r.can.review ? 'Review' : r.can.upload ? 'Upload' : 'Open'}</button></td></tr>))}</tbody></table></section>)}
    {drawer && <EvidenceDrawer tid={tid} itemId={drawer} onClose={() => setDrawer(null)} refresh={refresh} />}
    {bulk && <BulkDialog tid={tid} eid={eid} onClose={() => setBulk(false)} onDone={() => { setBulk(false); refresh(); }} />}</div>);
}

function BulkDialog({ tid, eid, onClose, onDone }: any) {
  const a = useDo(); const [f, setF] = useState({ instructions: '', dueDate: '', validMonths: '', templateId: '' }); const [result, setResult] = useState<any>(null);
  const submit = (e: FormEvent) => { e.preventDefault(); a.run(async () => { setResult(await api('POST', `/t/${tid}/engagements/${eid}/evidence-requests/bulk`, { allWithoutRequests: true, instructions: f.instructions || null, dueDate: f.dueDate || null, validMonths: f.validMonths ? Number(f.validMonths) : null })); }); };
  return (<Modal title="Request evidence for every item" onClose={result ? onDone : onClose}>{result ? (<div><p className="mb-2 text-sm">Created <b>{result.created}</b> request(s). Skipped {result.skippedCount}{result.skippedReasons?.not_applicable ? ` (${result.skippedReasons.not_applicable} not applicable)` : ''}{result.skippedReasons?.already_requested ? ` (${result.skippedReasons.already_requested} already requested)` : ''}.</p><button className="btn" onClick={onDone}>Done</button></div>)
    : (<form onSubmit={submit}><p className="mb-3 text-sm text-slate-600">Creates one request per checklist item that has none yet. Items that are not applicable are skipped.</p>{a.err && <ErrorBox message={a.err} />}
      <label className="block text-sm font-medium">Instructions for the client (optional)<textarea className="input" rows={3} value={f.instructions} onChange={e => setF({ ...f, instructions: e.target.value })} /></label><Field label="Due date (optional)" type="date" value={f.dueDate} onChange={e => setF({ ...f, dueDate: e.target.value })} />
      <Field label="Evidence stays valid for (months, optional)" type="number" min={1} max={120} value={f.validMonths} onChange={e => setF({ ...f, validMonths: e.target.value })} /><button className="btn" disabled={a.busy}>Create requests</button></form>)}</Modal>);
}

// ---------------------------------------------------------------- per-item drawer
export function EvidenceDrawer({ tid, itemId, onClose, refresh }: { tid: string; itemId: string; onClose: () => void; refresh: () => void }) {
  const q = useQuery({ queryKey: ['evidence-item', tid, itemId], queryFn: () => api<any>('GET', `/t/${tid}/checklist/${itemId}/evidence`) }); const cfg = useConfig(tid);
  const reload = () => { q.refetch(); cfg.refetch(); refresh(); };
  return (<Modal wide title={q.data ? `Evidence: ${q.data.item.ref} ${q.data.item.title}` : 'Evidence'} onClose={onClose}>
    {q.isLoading ? <Spinner /> : q.isError ? <ErrorBox message="Could not load evidence for this item" /> : (<div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm"><EvidenceStatusBadge status={q.data.item.evidence} />{q.data.engagementStatus === 'closed' && <Badge>engagement closed: read-only</Badge>}{cfg.data && <div className="ml-auto"><UsageBar usage={cfg.data.usage} /></div>}</div>
      {!q.data.requests.length && <Empty>No evidence has been requested for this item.</Empty>}
      {q.data.requests.map((r: any) => <RequestCard key={r.id} r={r} tid={tid} cfg={cfg.data} reload={reload} />)}
      {q.data.canRequest && <NewRequest tid={tid} itemId={itemId} reload={reload} />}</div>)}</Modal>);
}

function NewRequest({ tid, itemId, reload }: any) {
  const a = useDo(); const [open, setOpen] = useState(false); const [f, setF] = useState({ title: '', instructions: '', dueDate: '', validMonths: '', templateId: '' });
  const submit = (e: FormEvent) => { e.preventDefault(); a.run(async () => { await api('POST', `/t/${tid}/checklist/${itemId}/evidence-requests`, { title: f.title, instructions: f.instructions || null, dueDate: f.dueDate || null, validMonths: f.validMonths ? Number(f.validMonths) : null, templateId: f.templateId || null }); setOpen(false); setF({ title: '', instructions: '', dueDate: '', validMonths: '', templateId: '' }); reload(); }); };
  if (!open) return <button className="btn-secondary w-fit" onClick={() => setOpen(true)}>Request evidence</button>;
  return (<form onSubmit={submit} className="card" aria-label="New evidence request"><h3 className="mb-2 font-semibold">New evidence request</h3>{a.err && <ErrorBox message={a.err} />}<Field label="What is needed" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} required />
    <label className="block text-sm font-medium">Instructions<textarea className="input" rows={2} value={f.instructions} onChange={e => setF({ ...f, instructions: e.target.value })} /></label>
    <TemplatePicker value={f.templateId} onChange={id => setF({ ...f, templateId: id })} />
    <div className="grid gap-2 sm:grid-cols-2"><Field label="Due date" type="date" value={f.dueDate} onChange={e => setF({ ...f, dueDate: e.target.value })} /><Field label="Valid for (months)" type="number" min={1} max={120} value={f.validMonths} onChange={e => setF({ ...f, validMonths: e.target.value })} /></div>
    <div className="flex gap-2"><button className="btn" disabled={a.busy || !f.title.trim()}>Create request</button><button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button></div></form>);
}

function RequestCard({ r, tid, cfg, reload }: any) {
  const a = useDo(); const [info, setInfo] = useState(''); const [cancel, setCancel] = useState(false);
  const download = (v: any) => a.run(async () => { setInfo(''); const blob = await apiBlob(`/t/${tid}/evidence-versions/${v.id}/download`); const h = await sha256Hex(await blob.arrayBuffer()); saveBlob(blob, v.fileName);
    setInfo(h === v.sha256 ? `Downloaded ${v.fileName}. SHA-256 matches the value recorded at upload.` : `WARNING: the downloaded file does not match the recorded SHA-256 of ${v.fileName}. Do not rely on it and tell an administrator.`); });
  const verify = (v: any) => a.run(async () => { setInfo(''); const x = await api<any>('GET', `/t/${tid}/evidence-versions/${v.id}/verify`); setInfo(x.ok ? `Stored copy of v${v.versionNo} is intact (SHA-256 verified).` : `WARNING: ${x.problem}`); });
  const scan = (v: any) => a.run(async () => { await api('POST', `/t/${tid}/evidence-versions/${v.id}/scan`); setInfo(`Scan of v${v.versionNo} queued. Reload in a moment to see the result.`); });
  return (<section className="card" aria-label={`Request ${r.title}`}>
    <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{r.title}</h3><Badge tone={requestTone(r)}>{requestLabel(r)}</Badge>{r.overdue && <Badge tone="red">overdue</Badge>}{r.dueDate && <span className="text-xs text-slate-500">due {r.dueDate}</span>}{r.validUntil && <span className="text-xs text-slate-500">valid until {r.validUntil}</span>}
      {r.templateId && r.templateFileName && <TemplateLink t={{ id: r.templateId, name: r.templateName, fileName: r.templateFileName, sha256: r.templateSha256 }} />}{r.can.manage && <button className="btn-secondary ml-auto" onClick={() => setCancel(true)}>Cancel request</button>}</div>
    {r.instructions && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{r.instructions}</p>}{r.status === 'cancelled' && <p className="mt-1 text-sm text-slate-600">Cancelled: {r.cancelReason}</p>}
    {a.err && <div className="mt-2"><ErrorBox message={a.err} /></div>}{info && <p role="status" className={`mt-2 rounded p-2 text-sm ${info.startsWith('WARNING') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`}>{info}</p>}
    {r.versions.length > 0 && (<div className="mt-3 overflow-x-auto"><table className="w-full min-w-[44rem] text-sm"><thead><tr className="text-left text-xs uppercase text-slate-500"><th className="p-1">Ver.</th><th>Item</th><th>SHA-256</th><th>Uploaded</th><th>Scan</th><th /></tr></thead><tbody>
      {r.versions.map((v: any) => (<tr key={v.id} className="border-t align-top"><td className="p-1">v{v.versionNo}</td><td>{v.kind === 'file' ? <>{v.fileName} <span className="text-xs text-slate-500">({fmtBytes(v.sizeBytes)})</span></> : v.linkUrl ? <a className="text-brand underline" href={v.linkUrl} target="_blank" rel="noopener noreferrer">Open link ({(v.linkProvider ?? 'other').replace('_', ' ')})</a> : <span className="text-slate-500">Link (hidden)</span>}{v.kind === 'link' && <div className="text-xs text-amber-700">Links cannot be verified: the target may change.</div>}{v.note && <div className="text-xs text-slate-600">“{v.note}”</div>}</td>
        <td className="font-mono text-xs" title={v.sha256 ?? ''}>{shortHash(v.sha256)}</td><td className="text-xs">{v.uploadedByName}<div className="text-slate-500">{when(v.uploadedAt)}</div></td><td>{v.kind === 'file' ? <Badge tone={SCAN_LABEL[v.scanStatus]?.[1]}>{SCAN_LABEL[v.scanStatus]?.[0]}</Badge> : '—'}</td>
        <td className="whitespace-nowrap text-right">{v.kind === 'file' && r.can.view && v.scanStatus !== 'infected' && <button className="btn-secondary mr-1" disabled={a.busy} onClick={() => download(v)}>Download</button>}{v.kind === 'file' && r.can.view && <button className="btn-secondary mr-1" disabled={a.busy} onClick={() => verify(v)}>Verify</button>}{v.kind === 'file' && r.can.scan && v.versionNo === r.latestVersionNo && <button className="btn-secondary" disabled={a.busy} onClick={() => scan(v)}>Scan</button>}</td></tr>))}</tbody></table></div>)}
    {r.reviews.length > 0 && (<div className="mt-3"><h4 className="text-xs font-semibold uppercase text-slate-500">Review history</h4><ul className="text-sm">{r.reviews.map((x: any) => <li key={x.id} className="border-t py-1"><Badge tone={x.decision === 'accepted' ? 'green' : 'red'}>{x.decision}</Badge> v{x.versionNo} by {x.reviewedByName} · {when(x.reviewedAt)}{x.validUntil ? ` · valid until ${x.validUntil}` : ''}<div className="text-slate-700">{x.note}</div></li>)}</ul></div>)}
    {r.can.upload && <UploadPanel r={r} tid={tid} cfg={cfg} reload={reload} />}{r.can.review && <ReviewPanel r={r} tid={tid} reload={reload} />}
    {cancel && <CancelDialog onClose={() => setCancel(false)} onSubmit={async (reason: string) => { await api('POST', `/t/${tid}/evidence-requests/${r.id}/cancel`, { reason }); setCancel(false); reload(); }} />}</section>);
}

function UploadPanel({ r, tid, cfg, reload }: any) {
  const a = useDo(); const file = useRef<HTMLInputElement>(null); const [note, setNote] = useState(''); const [link, setLink] = useState(''); const [pick, setPick] = useState<string | null>(null);
  const onPick = () => { const f = file.current?.files?.[0]; setPick(f && cfg ? checkPick(f.name, f.size, cfg.maxFileBytes, cfg.allowedExtensions) : null); };
  const send = (e: FormEvent) => { e.preventDefault(); const f = file.current?.files?.[0]; if (!f) return; a.run(async () => { await apiUpload(`/t/${tid}/evidence-requests/${r.id}/versions`, f, note.trim() ? { note: note.trim() } : {}); setNote(''); if (file.current) file.current.value = ''; reload(); }); };
  const sendLink = (e: FormEvent) => { e.preventDefault(); a.run(async () => { await api('POST', `/t/${tid}/evidence-requests/${r.id}/versions`, { linkUrl: link.trim(), note: note.trim() || null }); setLink(''); setNote(''); reload(); }); };
  return (<div className="mt-3 grid gap-3 rounded border border-dashed p-3 md:grid-cols-2" aria-label="Add evidence"><h4 className="text-sm font-semibold md:col-span-2">{r.latestVersionNo ? `Upload version ${r.latestVersionNo + 1}` : 'Provide evidence'}{r.status === 'accepted' && <span className="ml-2 font-normal text-amber-700">A new version needs to be reviewed again.</span>}</h4>{a.err && <div className="md:col-span-2"><ErrorBox message={a.err} /></div>}
    <form onSubmit={send}><label className="block text-sm font-medium">File<input ref={file} type="file" className="input" onChange={onPick} accept={cfg?.allowedExtensions?.map((x: string) => '.' + x).join(',')} /></label>{pick && <p role="alert" className="mb-2 text-sm text-red-700">{pick}</p>}{cfg && <p className="mb-2 text-xs text-slate-500">Up to {fmtBytes(cfg.maxFileBytes)}. Allowed: {cfg.allowedExtensions.join(', ')}</p>}<button className="btn" disabled={a.busy || !!pick}>Upload file</button></form>
    <form onSubmit={sendLink}><Field label="…or a link (Google Drive, OneDrive, …)" type="url" placeholder="https://" value={link} onChange={e => setLink(e.target.value)} /><button className="btn-secondary" disabled={a.busy || !link.trim()}>Add link</button></form>
    <label className="block text-sm font-medium md:col-span-2">Note for the reviewer (optional)<textarea className="input" rows={2} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /></label></div>);
}

function ReviewPanel({ r, tid, reload }: any) {
  const a = useDo(); const [decision, setDecision] = useState<'accepted' | 'rejected'>('accepted'); const [note, setNote] = useState(''); const [validUntil, setValidUntil] = useState(''); const latest = r.versions.find((v: any) => v.versionNo === r.latestVersionNo);
  const submit = (e: FormEvent) => { e.preventDefault(); a.run(async () => { await api('POST', `/t/${tid}/evidence-requests/${r.id}/review`, { versionId: latest.id, decision, note: note.trim(), validUntil: decision === 'accepted' && validUntil ? validUntil : null }); setNote(''); setValidUntil(''); reload(); }); };
  if (!latest) return null;
  return (<form onSubmit={submit} className="mt-3 rounded border border-brand/40 p-3" aria-label="Review evidence"><h4 className="mb-2 text-sm font-semibold">Review version {latest.versionNo}</h4>{a.err && <ErrorBox message={a.err} />}
    <div className="mb-2 flex gap-4 text-sm"><label><input type="radio" name={`d-${r.id}`} checked={decision === 'accepted'} onChange={() => setDecision('accepted')} /> Accept</label><label><input type="radio" name={`d-${r.id}`} checked={decision === 'rejected'} onChange={() => setDecision('rejected')} /> Reject</label></div>
    <label className="block text-sm font-medium">Note (required)<textarea className="input" rows={3} value={note} onChange={e => setNote(e.target.value)} required /></label>
    {decision === 'accepted' && <Field label={r.validMonths ? `Valid until (default: ${r.validMonths} months from today)` : 'Valid until (optional)'} type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} />}
    <button className="btn" disabled={a.busy || !note.trim()}>{decision === 'accepted' ? 'Accept evidence' : 'Reject evidence'}</button></form>);
}

function CancelDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const a = useDo(); const [reason, setReason] = useState('');
  return (<Modal title="Cancel this evidence request" onClose={onClose}><form onSubmit={e => { e.preventDefault(); a.run(() => onSubmit(reason.trim())); }}>{a.err && <ErrorBox message={a.err} />}<p className="mb-2 text-sm text-slate-600">Uploaded versions and reviews are kept for the record.</p><label className="block text-sm font-medium">Reason (required)<textarea className="input" rows={3} value={reason} onChange={e => setReason(e.target.value)} required /></label><button className="btn" disabled={a.busy || !reason.trim()}>Cancel request</button></form></Modal>);
}

// ---------------------------------------------------------------- platform: per-organization evidence storage (Organizations page)
export function StoragePanel({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const a = useDo(); const q = useQuery({ queryKey: ['evidence-usage', orgId], queryFn: () => api<any>('GET', `/platform/organizations/${orgId}/evidence-usage`) }); const [mb, setMb] = useState('');
  if (q.isLoading) return <Spinner />; if (q.isError) return <ErrorBox message="Could not load storage usage" />;
  const u = q.data; const set = (value: number | null) => a.run(async () => { await api('PUT', `/platform/organizations/${orgId}/evidence-quota`, { quotaMb: value }); setMb(''); await q.refetch(); });
  return (<div className="mt-3 rounded border p-3" aria-label="Evidence storage"><h3 className="mb-2 text-sm font-semibold">Evidence storage</h3><UsageBar usage={u} /><p className="mt-1 text-xs text-slate-500">{u.versionCount} stored version(s) · {u.quotaIsDefault ? `platform default quota (${fmtBytes(u.defaultQuotaBytes)})` : 'custom quota'}</p>{a.err && <ErrorBox message={a.err} />}
    {canEdit && <form className="mt-2 flex items-end gap-2" onSubmit={e => { e.preventDefault(); set(Number(mb)); }}><div><Field label="Quota (MB)" type="number" min={1} value={mb} onChange={e => setMb(e.target.value)} required /></div><button className="btn mb-3" disabled={a.busy || !Number(mb)}>Set quota</button>{!u.quotaIsDefault && <button type="button" className="btn-secondary mb-3" disabled={a.busy} onClick={() => set(null)}>Use default</button>}</form>}</div>);
}
