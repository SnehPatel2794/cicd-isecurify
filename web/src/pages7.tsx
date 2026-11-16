// Findings screens (Phase 6B): the engagement Findings tab, the finding drawer (details, workflow, timeline) and the per-item findings drawer.
import { FormEvent, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ImportDialog } from './pages11'; import { api } from './api'; import { Empty, ErrorBox, Field, Spinner } from './ui'; import { Badge, Modal, useDo } from './kit';
import { Link, useParams, useSearchParams } from 'react-router-dom'; import { useQueryClient } from '@tanstack/react-query'; import { REQUEST_LABEL, requestLabel, requestTone } from './evidenceUi'; import { EvidenceDrawer } from './pages5';
import { BUCKETS, ageText, bucketLabel, lateText, trackingQuery, SEVERITIES, SEVERITY_LABEL, SEVERITY_TONE, STATUS_LABEL, STATUS_TONE, eventText, notePrompt, refOf, suggestedDue, summaryChips, transitionLabel } from './findingsUi';

const when = (v: string | Date | null | undefined) => v ? new Date(v).toISOString().slice(0, 16).replace('T', ' ') : '—';
const todayStr = () => new Date().toISOString().slice(0, 10);
export const SeverityBadge = ({ severity }: { severity: string }) => <Badge tone={SEVERITY_TONE[severity] ?? 'slate'}>{SEVERITY_LABEL[severity] ?? severity}</Badge>;
export const FindingStatusBadge = ({ status }: { status: string }) => <Badge tone={STATUS_TONE[status] ?? 'slate'}>{STATUS_LABEL[status] ?? status}</Badge>;
const useOwners = (tid: string, enabled: boolean) => useQuery({ queryKey: ['finding-owners', tid], enabled, queryFn: async () => (await api<any[]>('GET', `/t/${tid}/members`)).filter(m => m.status === 'active' && ['client_admin', 'client_staff', 'third_party_vendor'].includes(m.role)) });

// ---------------------------------------------------------------- tab
export function FindingsTab({ tid, eid, d, refresh }: any) {
  const closed = d.status === 'closed'; const [status, setStatus] = useState(''); const [severity, setSeverity] = useState(''); const [unresolved, setUnresolved] = useState(false); const [open, setOpen] = useState<string | null>(null); const [raise, setRaise] = useState(false); const [imp, setImp] = useState(false);
  const qs = new URLSearchParams({ ...(status && { status }), ...(severity && { severity }), ...(unresolved && { unresolved: 'true' }) }).toString();
  const q = useQuery({ queryKey: ['findings', tid, eid, status, severity, unresolved], queryFn: () => api<any>('GET', `/t/${tid}/engagements/${eid}/findings${qs ? '?' + qs : ''}`), placeholderData: keepPreviousData });   // keep the filters on screen while a new filter loads
  if (q.isLoading) return <Spinner />; if (q.isError) return <ErrorBox message="Could not load findings" />;
  const chips = summaryChips(q.data.summary);
  return (<div className="grid gap-3">
    <div className="flex flex-wrap items-center gap-3">{chips.map(([l, n, t]) => <div key={l} className="card px-3 py-2"><div className="text-xs uppercase text-slate-500">{l}</div><div className={`text-xl font-semibold ${t === 'red' ? 'text-red-700' : t === 'amber' ? 'text-amber-700' : ''}`}>{n}</div></div>)}
      {q.data.canRaise && !closed && <button className="btn-secondary ml-auto" onClick={() => setImp(true)}>Import scan results</button>}{q.data.canRaise && <button className={q.data.canRaise && !closed ? 'btn' : 'btn ml-auto'} onClick={() => setRaise(true)}>Raise a finding</button>}</div>
    <div className="flex flex-wrap items-center gap-2"><select aria-label="Filter by finding status" className="rounded border px-2 py-1 text-sm" value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <select aria-label="Filter by severity" className="rounded border px-2 py-1 text-sm" value={severity} onChange={e => setSeverity(e.target.value)}><option value="">All severities</option>{SEVERITIES.map(v => <option key={v} value={v}>{SEVERITY_LABEL[v]}</option>)}</select>
      <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={unresolved} onChange={e => setUnresolved(e.target.checked)} />Unresolved only</label><span className="text-xs text-slate-500">{q.data.findings.length} finding(s){q.data.truncated ? ' (showing the first 2000)' : ''}</span></div>
    {closed && <p className="text-sm text-slate-600">This engagement is closed: findings are read-only.</p>}
    {!q.data.findings.length ? <Empty>No findings{status || severity || unresolved ? ' match these filters' : ' yet'}.</Empty> : (<section className="card overflow-x-auto"><table className="w-full min-w-[56rem] text-sm"><thead><tr className="text-left text-xs uppercase text-slate-500"><th className="p-1">Ref</th><th>Finding</th><th>Severity</th><th>Status</th><th>Owner</th><th>Due</th><th /></tr></thead><tbody>
      {q.data.findings.map((f: any) => (<tr key={f.id} className="border-t align-top"><td className="w-20 p-1 font-mono text-xs">{f.ref}</td><td className="pr-2">{f.title}<div className="text-xs text-slate-500">{f.itemRef} · {f.itemTitle}</div></td><td><SeverityBadge severity={f.severity} /></td>
        <td><FindingStatusBadge status={f.status} />{f.blocking && <> <Badge tone="red" title="This unresolved finding stops the control from being effective">blocks control</Badge></>}{f.overdue && <> <Badge tone="red">overdue</Badge></>}</td><td>{f.ownerName ?? <span className="text-slate-500">unassigned</span>}</td><td>{f.dueDate ?? '—'}</td>
        <td className="text-right"><button className="btn-secondary" aria-label={`Open ${f.ref}`} onClick={() => setOpen(f.id)}>Open</button></td></tr>))}</tbody></table></section>)}
    {open && <FindingDrawer tid={tid} id={open} onClose={() => setOpen(null)} refresh={refresh} />}
    {raise && <RaiseDialog tid={tid} eid={eid} d={d} onClose={() => setRaise(false)} onDone={() => { setRaise(false); refresh(); }} />}
    {imp && <ImportDialog tid={tid} eid={eid} onClose={() => setImp(false)} onDone={() => { q.refetch(); refresh(); }} />}</div>);
}

// ---------------------------------------------------------------- raise
export function RaiseDialog({ tid, eid, d, itemId, onClose, onDone }: { tid: string; eid?: string; d: any; itemId?: string; onClose: () => void; onDone: () => void }) {
  const a = useDo(); const canAssign = !!d.permissions?.manage; const owners = useOwners(tid, canAssign);   // manage = client admins and managing staff, same as the server rule
 
  const items = useQuery({ queryKey: ['checklist', tid, eid], enabled: !itemId && !!eid, queryFn: () => api<any>('GET', `/t/${tid}/engagements/${eid}/checklist`) });
  const [f, setF] = useState({ itemId: itemId ?? '', title: '', description: '', recommendation: '', severity: 'medium', dueDate: suggestedDue('medium', todayStr()), ownerUserId: '' }); const [dueTouched, setDueTouched] = useState(false);
  const setSeverity = (s: string) => setF({ ...f, severity: s, dueDate: dueTouched ? f.dueDate : suggestedDue(s, todayStr()) });
  const submit = (e: FormEvent) => { e.preventDefault(); a.run(async () => { await api('POST', `/t/${tid}/checklist/${f.itemId}/findings`, { title: f.title, description: f.description, severity: f.severity, recommendation: f.recommendation || null, dueDate: f.dueDate || null, ownerUserId: f.ownerUserId || null }); onDone(); }); };
  const choices = (items.data?.items ?? []).filter((i: any) => i.readiness !== 'not_applicable');
  return (<Modal wide title="Raise a finding" onClose={onClose}><form onSubmit={submit} className="space-y-2" aria-label="Raise finding">{a.err && <ErrorBox message={a.err} />}
    {!itemId && <label className="block text-sm font-medium">Checklist item<select className="input" required value={f.itemId} onChange={e => setF({ ...f, itemId: e.target.value })} aria-label="Checklist item"><option value="">Choose the item this finding is about…</option>{choices.map((i: any) => <option key={i.id} value={i.id}>{i.ref} · {i.title}</option>)}</select></label>}
    <Field label="Title" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} required maxLength={300} />
    <label className="block text-sm font-medium">What is wrong<textarea className="input" rows={4} required value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></label>
    <label className="block text-sm font-medium">Recommendation (optional)<textarea className="input" rows={2} value={f.recommendation} onChange={e => setF({ ...f, recommendation: e.target.value })} /></label>
    <div className="grid gap-2 sm:grid-cols-3"><label className="block text-sm font-medium">Severity<select className="input" value={f.severity} onChange={e => setSeverity(e.target.value)} aria-label="Severity">{SEVERITIES.map(v => <option key={v} value={v}>{SEVERITY_LABEL[v]}</option>)}</select></label>
      <Field label="Remediate by" type="date" value={f.dueDate} onChange={e => { setDueTouched(true); setF({ ...f, dueDate: e.target.value }); }} />
      {canAssign && <label className="block text-sm font-medium">Owner<select className="input" value={f.ownerUserId} onChange={e => setF({ ...f, ownerUserId: e.target.value })} aria-label="Owner"><option value="">Assign later</option>{(owners.data ?? []).map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}</div>
    {['critical', 'high', 'medium'].includes(f.severity) && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">Until it is closed or its risk is accepted, this finding stops the control from showing as Effective and stops the engagement from being closed.</p>}
    <div className="flex gap-2"><button className="btn" disabled={a.busy || !f.itemId || !f.title.trim() || !f.description.trim()}>Raise finding</button><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button></div></form></Modal>);
}

// ---------------------------------------------------------------- drawer
export function FindingDrawer({ tid, id, onClose, refresh }: { tid: string; id: string; onClose: () => void; refresh: () => void }) {
  const q = useQuery({ queryKey: ['finding', tid, id], queryFn: () => api<any>('GET', `/t/${tid}/findings/${id}`) }); const reload = () => { q.refetch(); refresh(); };
  const f = q.data;
  return (<Modal wide title={f ? `${f.ref} ${f.title}` : 'Finding'} onClose={onClose}>{q.isLoading ? <Spinner /> : q.isError ? <ErrorBox message="Could not load this finding" /> : (<div className="grid gap-4">
    <div className="flex flex-wrap items-center gap-2 text-sm"><SeverityBadge severity={f.severity} /><FindingStatusBadge status={f.status} />{f.blocking && <Badge tone="red">blocks control {f.itemRef}</Badge>}{f.overdue && <Badge tone="red">overdue</Badge>}<span className="text-slate-500">{f.itemRef} · {f.itemTitle}</span></div>
    <section className="grid gap-1 text-sm"><p className="whitespace-pre-wrap">{f.description}</p>{f.recommendation && <p className="whitespace-pre-wrap text-slate-700"><span className="font-medium">Recommendation: </span>{f.recommendation}</p>}
      <dl className="mt-1 grid gap-x-6 gap-y-1 text-xs text-slate-600 sm:grid-cols-4"><div><dt className="uppercase">Raised by</dt><dd>{f.raisedBy} · {when(f.createdAt)}</dd></div><div><dt className="uppercase">Owner</dt><dd>{f.ownerName ?? 'unassigned'}</dd></div><div><dt className="uppercase">Due</dt><dd>{f.dueDate ?? '—'}</dd></div><div><dt className="uppercase">Closed</dt><dd>{when(f.closedAt)}</dd></div></dl>
      {f.remediationPlan && <p className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-2 text-sm"><span className="font-medium">Remediation plan: </span>{f.remediationPlan}</p>}</section>
    <RemediationEvidence f={f} tid={tid} reload={reload} /><Workflow f={f} tid={tid} reload={reload} />{(f.can.edit || f.can.assign || f.can.plan) && <EditPanel f={f} tid={tid} reload={reload} />}<Timeline f={f} tid={tid} reload={reload} /></div>)}</Modal>);
}
function Workflow({ f, tid, reload }: any) {
  const a = useDo(); const [to, setTo] = useState<string | null>(null); const [note, setNote] = useState(''); const t = f.can.transitions.find((x: any) => x.to === to);
  if (!f.can.transitions.length) return null;
  const submit = (e: FormEvent) => { e.preventDefault(); a.run(async () => { await api('POST', `/t/${tid}/findings/${f.id}/transition`, { to, note: note.trim() || null }); setTo(null); setNote(''); reload(); }); };
  return (<section className="card" aria-label="Finding workflow"><h3 className="mb-2 font-semibold">Next step</h3>{a.err && <ErrorBox message={a.err} />}
    <div className="flex flex-wrap gap-2">{f.can.transitions.map((x: any) => <button key={x.to} className={x.to === 'cancelled' ? 'btn-secondary' : 'btn'} aria-pressed={to === x.to} onClick={() => { setTo(x.to); setNote(''); }}>{transitionLabel(f.status, x.to)}</button>)}</div>
    {to && t && (<form onSubmit={submit} className="mt-3 space-y-2" aria-label="Confirm change"><label className="block text-sm font-medium">{notePrompt(to)}{t.note ? ' (required)' : ' (optional)'}<textarea className="input" rows={2} value={note} onChange={e => setNote(e.target.value)} /></label>
      <div className="flex gap-2"><button className="btn" disabled={a.busy || (t.note && !note.trim())}>Confirm: {transitionLabel(f.status, to)}</button><button type="button" className="btn-secondary" onClick={() => setTo(null)}>Back</button></div></form>)}</section>);
}
function EditPanel({ f, tid, reload }: any) {
  const a = useDo(); const [open, setOpen] = useState(false); const owners = useOwners(tid, f.can.assign);
  const [v, setV] = useState({ title: f.title, description: f.description, recommendation: f.recommendation ?? '', severity: f.severity, ownerUserId: f.ownerUserId ?? '', dueDate: f.dueDate ?? '', remediationPlan: f.remediationPlan ?? '', note: '' });
  if (!open) return <button className="btn-secondary w-fit" onClick={() => setOpen(true)}>Edit details</button>;
  const sevChanged = v.severity !== f.severity;
  const submit = (e: FormEvent) => { e.preventDefault(); a.run(async () => { const body: any = {};
    if (f.can.edit) { if (v.title !== f.title) body.title = v.title; if (v.description !== f.description) body.description = v.description; if (v.recommendation !== (f.recommendation ?? '')) body.recommendation = v.recommendation || null; if (sevChanged) { body.severity = v.severity; body.note = v.note; } }
    if (f.can.assign && v.ownerUserId !== (f.ownerUserId ?? '')) body.ownerUserId = v.ownerUserId || null; if ((f.can.assign || f.can.edit) && v.dueDate !== (f.dueDate ?? '')) body.dueDate = v.dueDate || null; if (f.can.plan && v.remediationPlan !== (f.remediationPlan ?? '')) body.remediationPlan = v.remediationPlan || null;
    if (!Object.keys(body).length) { setOpen(false); return; } await api('PATCH', `/t/${tid}/findings/${f.id}`, body); setOpen(false); reload(); }); };
  return (<form onSubmit={submit} className="card space-y-2" aria-label="Edit finding"><h3 className="font-semibold">Edit details</h3>{a.err && <ErrorBox message={a.err} />}
    {f.can.edit && <><Field label="Title" value={v.title} onChange={e => setV({ ...v, title: e.target.value })} maxLength={300} /><label className="block text-sm font-medium">Description<textarea className="input" rows={3} value={v.description} onChange={e => setV({ ...v, description: e.target.value })} /></label>
      <label className="block text-sm font-medium">Recommendation<textarea className="input" rows={2} value={v.recommendation} onChange={e => setV({ ...v, recommendation: e.target.value })} /></label>
      <label className="block text-sm font-medium">Severity<select className="input" aria-label="Severity" value={v.severity} onChange={e => setV({ ...v, severity: e.target.value })}>{SEVERITIES.map(s => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}</select></label>
      {sevChanged && <label className="block text-sm font-medium">Why is the severity changing? (required)<textarea className="input" rows={2} value={v.note} onChange={e => setV({ ...v, note: e.target.value })} /></label>}</>}
    {(f.can.assign || f.can.edit) && <div className="grid gap-2 sm:grid-cols-2">{f.can.assign && <label className="block text-sm font-medium">Owner<select className="input" aria-label="Owner" value={v.ownerUserId} onChange={e => setV({ ...v, ownerUserId: e.target.value })}><option value="">Unassigned</option>{(owners.data ?? []).map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
      <Field label="Remediate by" type="date" value={v.dueDate} onChange={e => setV({ ...v, dueDate: e.target.value })} /></div>}
    {f.can.plan && <label className="block text-sm font-medium">Remediation plan<textarea className="input" rows={3} value={v.remediationPlan} onChange={e => setV({ ...v, remediationPlan: e.target.value })} /></label>}
    <div className="flex gap-2"><button className="btn" disabled={a.busy || (sevChanged && !v.note.trim())}>Save</button><button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button></div></form>);
}
function Timeline({ f, tid, reload }: any) {
  const a = useDo(); const [note, setNote] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); a.run(async () => { await api('POST', `/t/${tid}/findings/${f.id}/comments`, { note }); setNote(''); reload(); }); };
  return (<section aria-label="History"><h3 className="mb-2 font-semibold">History</h3><ol className="space-y-2 text-sm">{f.events.map((e: any) => (<li key={e.id} className="border-l-2 border-slate-200 pl-3"><div><span className="font-medium">{e.actorName}</span> {eventText(e)} <span className="text-xs text-slate-500">{when(e.createdAt)}</span></div>{e.note && <div className="whitespace-pre-wrap text-slate-700">{e.note}</div>}</li>))}</ol>
    {f.can.comment && <form onSubmit={submit} className="mt-3 flex items-end gap-2" aria-label="Add comment"><label className="flex-1 text-sm font-medium">Add a comment<textarea className="input" rows={2} value={note} onChange={e => setNote(e.target.value)} /></label><button className="btn" disabled={a.busy || !note.trim()}>Comment</button></form>}{a.err && <ErrorBox message={a.err} />}</section>);
}

// ---------------------------------------------------------------- per item
export function ItemFindingsDrawer({ tid, itemId, d, onClose, refresh }: { tid: string; itemId: string; d: any; onClose: () => void; refresh: () => void }) {
  const q = useQuery({ queryKey: ['finding-item', tid, itemId], queryFn: () => api<any>('GET', `/t/${tid}/checklist/${itemId}/findings`) }); const [open, setOpen] = useState<string | null>(null); const [raise, setRaise] = useState(false);
  const reload = () => { q.refetch(); refresh(); };
  return (<Modal wide title={q.data ? `Findings: ${q.data.item.ref} ${q.data.item.title}` : 'Findings'} onClose={onClose}>{q.isLoading ? <Spinner /> : q.isError ? <ErrorBox message="Could not load findings for this item" /> : (<div className="grid gap-3">
    {!q.data.findings.length && <Empty>No findings for this item.</Empty>}
    {q.data.findings.map((f: any) => (<div key={f.id} className="card flex flex-wrap items-center gap-2"><span className="font-mono text-xs">{f.ref}</span><span className="font-medium">{f.title}</span><SeverityBadge severity={f.severity} /><FindingStatusBadge status={f.status} />{f.blocking && <Badge tone="red">blocks control</Badge>}<button className="btn-secondary ml-auto" aria-label={`Open ${f.ref}`} onClick={() => setOpen(f.id)}>Open</button></div>))}
    {q.data.canRaise && <button className="btn w-fit" onClick={() => setRaise(true)}>Raise a finding on this item</button>}
    {open && <FindingDrawer tid={tid} id={open} onClose={() => setOpen(null)} refresh={reload} />}{raise && <RaiseDialog tid={tid} d={d} itemId={itemId} onClose={() => setRaise(false)} onDone={() => { setRaise(false); reload(); }} />}</div>)}</Modal>);
}
export { refOf };

// ---------------------------------------------------------------- remediation evidence (6C)
function RemediationEvidence({ f, tid, reload }: any) {
  const a = useDo(); const [pick, setPick] = useState(''); const [title, setTitle] = useState(''); const [show, setShow] = useState(false);
  const lk = useQuery({ queryKey: ['finding-linkable', tid, f.id, f.evidence.length], enabled: !!f.can.linkEvidence, queryFn: () => api<any[]>('GET', `/t/${tid}/findings/${f.id}/linkable-evidence`) });
  const attach = (requestId: string) => a.run(async () => { await api('POST', `/t/${tid}/findings/${f.id}/evidence`, { requestId }); setPick(''); reload(); });
  const request = (e: FormEvent) => { e.preventDefault(); a.run(async () => { const r = await api<any>('POST', `/t/${tid}/checklist/${f.itemId}/evidence-requests`, { title }); await api('POST', `/t/${tid}/findings/${f.id}/evidence`, { requestId: r.id }); setTitle(''); reload(); }); };
  return (<section className="card" aria-label="Remediation evidence"><div className="mb-2 flex items-center gap-2"><h3 className="font-semibold">Remediation evidence</h3>{!!f.evidence.length && <button className="btn-secondary ml-auto" onClick={() => setShow(true)}>Open evidence for {f.itemRef}</button>}</div>{a.err && <ErrorBox message={a.err} />}
    {!f.evidence.length ? <p className="text-sm text-slate-500">Nothing attached yet. Attach the evidence that shows the fix, so the retest can be done from here.</p> : (<ul className="space-y-1 text-sm">{f.evidence.map((r: any) => (<li key={r.requestId} className="flex flex-wrap items-center gap-2"><span>{r.title}</span><Badge tone={requestTone(r)}>{requestLabel(r)}</Badge>{r.validUntil && <span className="text-xs text-slate-500">valid until {r.validUntil}</span>}<span className="text-xs text-slate-500">{r.versionCount ? `${r.versionCount} version(s)` : 'nothing uploaded yet'} · attached by {r.linkedByName}</span></li>))}</ul>)}
    {f.can.linkEvidence && (<div className="mt-3 flex flex-wrap items-end gap-2">{!!lk.data?.length && (<><label className="text-sm font-medium">Attach an existing request<select className="input" aria-label="Attach evidence request" value={pick} onChange={e => setPick(e.target.value)}><option value="">Choose…</option>{lk.data.map((r: any) => <option key={r.requestId} value={r.requestId}>{r.title} ({REQUEST_LABEL[r.status] ?? r.status})</option>)}</select></label><button className="btn-secondary" disabled={!pick || a.busy} onClick={() => attach(pick)}>Attach</button></>)}
      {f.can.assign && (<form onSubmit={request} className="flex items-end gap-2" aria-label="Request remediation evidence"><label className="text-sm font-medium">Or ask for new evidence<input className="input" placeholder="What should be uploaded?" value={title} onChange={e => setTitle(e.target.value)} maxLength={300} /></label><button className="btn-secondary" disabled={!title.trim() || a.busy}>Request and attach</button></form>)}</div>)}
    {show && <EvidenceDrawer tid={tid} itemId={f.itemId} onClose={() => setShow(false)} refresh={reload} />}</section>);
}

// ---------------------------------------------------------------- organization-wide remediation tracking (6C)
import { ExportButtons, SavedViews } from './portalWidgets'; import { findingsToView, findingsFromView } from './portalUi';
export function FindingsPage() {
  const { tid } = useParams(); const qc = useQueryClient(); const [sp] = useSearchParams(); const [f, setF] = useState({ mine: sp.get('mine') === 'true', overdue: sp.get('overdue') === 'true', awaitingRetest: sp.get('awaitingRetest') === 'true', unresolved: sp.get('unresolved') !== 'false', status: sp.get('status') ?? '', severity: sp.get('severity') ?? '' }); const [open, setOpen] = useState<string | null>(sp.get('open') && /^[0-9a-f-]{36}$/i.test(sp.get('open')!) ? sp.get('open') : null);
  const qs = trackingQuery(f); const q = useQuery({ queryKey: ['org-findings', tid, qs], queryFn: () => api<any>('GET', `/t/${tid}/findings${qs}`), placeholderData: keepPreviousData });
  const refresh = () => { for (const k of ['org-findings', 'findings', 'finding', 'finding-item', 'finding-linkable', 'checklist', 'engagement', 'evidence', 'evidence-item']) qc.invalidateQueries({ queryKey: [k] }); };
  if (q.isLoading) return <Spinner />; if (q.isError) return <ErrorBox message="Could not load findings" />;
  const s = q.data.summary; const set = (k: string, v: any) => setF({ ...f, [k]: v });
  return (<div className="space-y-4"><div className="flex flex-wrap items-center gap-3"><h1 className="text-xl font-semibold">Findings and remediation</h1><span className="ml-auto inline-flex flex-wrap items-center gap-2"><SavedViews tid={tid!} page="findings" current={findingsToView(f)} onApply={v => setF(findingsFromView(v))} /><ExportButtons tid={tid!} path="/findings-export" base="findings" params={{ ...Object.fromEntries(Object.entries(findingsToView(f)).map(([k, v]) => [k, v])) }} /></span></div>
    <div className="flex flex-wrap gap-3">{[['Unresolved', s.unresolved, ''], ['Blocking controls', s.blocking, s.blocking ? 'text-red-700' : ''], ['Overdue', s.overdue, s.overdue ? 'text-red-700' : ''], ['Ready for retest', s.byStatus.ready_for_retest, ''], ['Closed', s.byStatus.closed, '']].map(([l, n, c]: any) => <div key={l} className="card px-3 py-2"><div className="text-xs uppercase text-slate-500">{l}</div><div className={`text-xl font-semibold ${c}`}>{n}</div></div>)}</div>
    {s.overdue > 0 && (<section className="card" aria-label="Overdue by age"><h2 className="mb-2 text-sm font-semibold">Overdue findings by age</h2><div className="flex flex-wrap gap-4 text-sm">{BUCKETS.map(b => <div key={b}><span className="text-lg font-semibold">{q.data.overdueBuckets[b] ?? 0}</span> <span className="text-slate-600">{bucketLabel(b)}</span></div>)}</div></section>)}
    <div className="flex flex-wrap items-center gap-3 text-sm"><label className="flex items-center gap-1"><input type="checkbox" checked={f.mine} onChange={e => set('mine', e.target.checked)} />Assigned to me</label><label className="flex items-center gap-1"><input type="checkbox" checked={f.overdue} onChange={e => set('overdue', e.target.checked)} />Overdue</label>
      <label className="flex items-center gap-1"><input type="checkbox" checked={f.awaitingRetest} onChange={e => set('awaitingRetest', e.target.checked)} />Ready for retest</label><label className="flex items-center gap-1"><input type="checkbox" checked={f.unresolved} onChange={e => set('unresolved', e.target.checked)} />Unresolved only</label>
      <select aria-label="Filter by finding status" className="rounded border px-2 py-1" value={f.status} onChange={e => set('status', e.target.value)}><option value="">All statuses</option>{Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <select aria-label="Filter by severity" className="rounded border px-2 py-1" value={f.severity} onChange={e => set('severity', e.target.value)}><option value="">All severities</option>{SEVERITIES.map(v => <option key={v} value={v}>{SEVERITY_LABEL[v]}</option>)}</select><span className="text-xs text-slate-500">{q.data.findings.length} finding(s)</span></div>
    {!q.data.findings.length ? <Empty>No findings match these filters.</Empty> : (<section className="card overflow-x-auto"><table className="w-full min-w-[60rem] text-sm"><thead><tr className="text-left text-xs uppercase text-slate-500"><th className="p-1">Ref</th><th>Finding</th><th>Severity</th><th>Status</th><th>Owner</th><th>Due</th><th>Open for</th><th /></tr></thead><tbody>
      {q.data.findings.map((x: any) => (<tr key={x.id} className="border-t align-top"><td className="w-20 p-1 font-mono text-xs">{x.ref}</td><td className="pr-2">{x.title}<div className="text-xs text-slate-500">{x.engagementName} · {x.itemRef}</div></td><td><SeverityBadge severity={x.severity} /></td><td><FindingStatusBadge status={x.status} />{x.blocking && <> <Badge tone="red">blocks control</Badge></>}</td>
        <td>{x.ownerName ?? <span className="text-slate-500">unassigned</span>}</td><td>{x.dueDate ?? '—'}{x.overdue && <div className="text-xs text-red-700">{lateText(x)}</div>}</td><td className="text-xs text-slate-600">{ageText(x.ageDays)}</td><td className="text-right"><button className="btn-secondary" aria-label={`Open ${x.ref} ${x.engagementName}`} onClick={() => setOpen(x.id)}>Open</button></td></tr>))}</tbody></table></section>)}
    {open && <FindingDrawer tid={tid!} id={open} onClose={() => setOpen(null)} refresh={refresh} />}</div>);
}
