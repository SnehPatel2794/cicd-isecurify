import { FormEvent, ReactNode, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query'; import { MappingHistoryDialog } from './pages24'; import { QuestionnaireAdmin } from './pages25'; import { TaskTemplatesAdmin } from './pages26';
import { api, apiBlob, apiUpload, saveBlob, ApiError } from './api'; import { useAuth } from './auth'; import { Empty, ErrorBox, Field, Spinner } from './ui'; import { groupByDomain } from './groupBy';

const msg = (e: unknown) => e instanceof ApiError ? e.message : 'Something went wrong';
const isAdmin = (role?: string) => role === 'super_admin' || role === 'admin';
function useDo() { const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => { setErr(''); setBusy(true); try { await fn(); } catch (e) { setErr(msg(e)); } finally { setBusy(false); } }; return { err, busy, run }; }
const Badge = ({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red' | 'brand' }) => <span className={`rounded px-1.5 py-0.5 text-xs ${{ slate: 'bg-slate-100 text-slate-700', green: 'bg-green-100 text-green-800', amber: 'bg-amber-100 text-amber-800', red: 'bg-red-100 text-red-800', brand: 'bg-brand-light text-brand' }[tone]}`}>{children}</span>;
const Modal = ({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) => (<div role="dialog" aria-label={title} className="fixed inset-0 z-10 grid place-items-center bg-black/40 p-4"><div className="card max-h-[90vh] w-full max-w-3xl overflow-auto"><div className="mb-3 flex items-center"><h2 className="text-lg font-semibold">{title}</h2><button className="btn-secondary ml-auto" onClick={onClose}>Close</button></div>{children}</div></div>);

// ---------------- library ----------------
export function FrameworksPage() {
  const { me } = useAuth(); const admin = isAdmin(me?.user.platformRole); const qc = useQueryClient(); const nav = useNavigate(); const a = useDo(); const [showArchived, setShowArchived] = useState(false); const [f, setF] = useState({ name: '', region: '' });
  const q = useQuery({ queryKey: ['frameworks', showArchived], queryFn: () => api<any[]>('GET', `/frameworks${showArchived ? '?includeArchived=true' : ''}`) });
  const create = (e: FormEvent) => { e.preventDefault(); a.run(async () => { const r = await api('POST', '/frameworks', { name: f.name, region: f.region || undefined }); qc.invalidateQueries({ queryKey: ['frameworks'] }); nav(`/releases/${r.draftReleaseId}`); }); };
  const tpl = (fmt: string) => a.run(async () => saveBlob(await apiBlob(`/frameworks/import-template?format=${fmt}`), `framework-import-template.${fmt}`));
  return (<div className="grid gap-4"><div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">Framework library</h1><div className="ml-auto flex flex-wrap gap-2">
    <button className="btn-secondary" onClick={() => tpl('xlsx')}>Excel template</button><button className="btn-secondary" onClick={() => tpl('csv')}>CSV template</button>
    {admin && <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> show archived</label>}</div></div>
    <p className="text-sm text-slate-600">Frameworks are versioned. A published release never changes; edits happen in a new draft release. Import only content you are licensed to use.</p>
    {admin && <form onSubmit={create} className="card flex flex-wrap items-end gap-2"><div className="min-w-[14rem] flex-1"><Field label="New framework name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required /></div><div className="w-40"><Field label="Region" value={f.region} onChange={e => setF({ ...f, region: e.target.value })} /></div><button className="btn mb-3" disabled={a.busy}>Create</button></form>}
    {a.err && <ErrorBox message={a.err} />}
    {q.isLoading ? <Spinner /> : q.isError ? <ErrorBox message={msg(q.error)} /> : !q.data!.length ? <Empty>No frameworks yet.{admin ? ' Create one above or import a spreadsheet into a new draft.' : ''}</Empty> :
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{q.data!.map(fw => (<Link key={fw.id} to={`/frameworks/${fw.id}`} className="card block border-t-4 hover:border-brand" style={{ borderTopColor: fw.color }}>
        <div className="flex items-center gap-2"><h2 className="font-semibold">{fw.name}</h2>{fw.archived ? <Badge tone="red">archived</Badge> : null}</div><div className="text-xs text-slate-500">{fw.region ?? '—'}</div>
        <div className="mt-2 flex flex-wrap gap-1">{fw.latestPublished ? <Badge tone="green">v{fw.latestPublished} published · {fw.controlCount} controls</Badge> : <Badge tone="amber">no published release</Badge>}{fw.draftReleaseId && <Badge tone="brand">draft open</Badge>}</div></Link>))}</div>}
    <TaskTemplatesAdmin admin={admin} frameworks={(q.data ?? []).filter((x: any) => !x.archived).map((x: any) => ({ id: x.id, name: x.name }))} /></div>);
}

// ---------------- one framework ----------------
export function FrameworkPage() {
  const { id } = useParams(); const { me } = useAuth(); const admin = isAdmin(me?.user.platformRole); const qc = useQueryClient(); const nav = useNavigate(); const a = useDo(); const [cmp, setCmp] = useState<string[]>([]);
  const q = useQuery({ queryKey: ['framework', id], queryFn: () => api<any>('GET', `/frameworks/${id}`) }); const refresh = () => { qc.invalidateQueries({ queryKey: ['framework', id] }); qc.invalidateQueries({ queryKey: ['frameworks'] }); };
  if (q.isLoading) return <Spinner />; if (q.isError) return <ErrorBox message={msg(q.error)} />; const f = q.data; const hasDraft = f.releases.some((r: any) => r.status === 'draft');
  const toggle = (rid: string) => setCmp(c => c.includes(rid) ? c.filter(x => x !== rid) : [...c, rid].slice(-2));
  return (<div className="grid gap-4"><div><Link to="/frameworks" className="text-sm text-brand underline">← Library</Link><div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{f.name}</h1>{f.archived && <Badge tone="red">archived</Badge>}
    {admin && <button className="btn-secondary ml-auto" onClick={() => a.run(async () => { await api('PATCH', `/frameworks/${id}`, { archived: !f.archived }); refresh(); })}>{f.archived ? 'Restore' : 'Archive'}</button>}</div>
    <p className="text-sm text-slate-600">{f.region ?? ''} {f.description ?? ''}</p></div>{a.err && <ErrorBox message={a.err} />}
    <section className="card"><div className="mb-2 flex items-center gap-2"><h2 className="font-semibold">Releases</h2><button className="btn-secondary ml-auto" disabled={cmp.length !== 2} onClick={() => nav(`/releases/${cmp[0]}/compare/${cmp[1]}`)}>Compare selected (2)</button></div>
      <table className="w-full text-sm"><thead><tr><th /><th className="text-left">Version</th><th className="text-left">Status</th><th className="text-left">Controls</th><th className="text-left">Published</th><th /></tr></thead><tbody>{f.releases.map((r: any) => (<tr key={r.id} className="border-t">
        <td><input type="checkbox" aria-label={`Select v${r.version} to compare`} checked={cmp.includes(r.id)} onChange={() => toggle(r.id)} /></td><td className="py-1">v{r.version}</td><td><Badge tone={r.status === 'published' ? 'green' : 'amber'}>{r.status}</Badge></td><td>{r.controlCount}</td><td>{r.publishedAt ? new Date(r.publishedAt).toLocaleDateString() : '—'}</td>
        <td className="text-right whitespace-nowrap"><Link className="btn-secondary mr-2" to={`/releases/${r.id}`}>{r.status === 'draft' && admin ? 'Edit' : 'View'}</Link>
          {admin && r.status === 'published' && !hasDraft && !f.archived && <button className="btn-secondary" onClick={() => a.run(async () => { const d = await api('POST', `/releases/${r.id}/new-draft`); refresh(); nav(`/releases/${d.id}`); })}>New draft from this</button>}</td></tr>))}</tbody></table>
      {hasDraft && admin && <p className="mt-2 text-xs text-slate-500">A framework can have one open draft at a time.</p>}</section>
    <QuestionnaireAdmin frameworkId={id!} admin={admin} /></div>);
}

// ---------------- import wizard ----------------
function ImportWizard({ releaseId, onClose, onDone }: { releaseId: string; onClose: () => void; onDone: () => void }) {
  const a = useDo(); const file = useRef<File | null>(null); const [name, setName] = useState(''); const [prev, setPrev] = useState<any>(null); const [res, setRes] = useState<any>(null);
  const preview = () => a.run(async () => { setPrev(await apiUpload(`/releases/${releaseId}/import`, file.current!)); });
  const confirmImport = () => a.run(async () => { setRes(await apiUpload(`/releases/${releaseId}/import?confirm=true`, file.current!)); onDone(); });
  return (<Modal title="Import controls from CSV or Excel" onClose={onClose}>{a.err && <ErrorBox message={a.err} />}
    {res ? <p className="text-sm text-green-700">Imported {res.imported} control(s){res.skipped ? `, skipped ${res.skipped} invalid row(s)` : ''}.</p> : <>
      <p className="mb-2 text-sm">1. Choose a .csv or .xlsx file (max 5 MB, 5,000 rows). Cells starting with = + - @ are refused.</p>
      <input type="file" aria-label="File to import" accept=".csv,.xlsx" onChange={e => { file.current = e.target.files?.[0] ?? null; setName(file.current?.name ?? ''); setPrev(null); }} />
      <div className="my-3"><button className="btn" disabled={!name || a.busy} onClick={preview}>2. Preview (nothing is saved)</button></div>
      {prev && <div><p className="mb-2 text-sm">Header found on row {prev.headerRow}. <b>{prev.counts.valid}</b> valid, <b>{prev.counts.invalid}</b> invalid of {prev.counts.total}.{prev.truncated && ' Showing the first 200 rows.'}</p>
        <div className="max-h-64 overflow-auto rounded border"><table className="w-full text-xs"><thead><tr><th className="p-1 text-left">Row</th><th className="p-1 text-left">Ref</th><th className="p-1 text-left">Requirement</th><th className="p-1 text-left">Result</th></tr></thead><tbody>{prev.rows.map((r: any) => (
          <tr key={r.row} className={`border-t ${r.valid ? '' : 'bg-red-50'}`}><td className="p-1">{r.row}</td><td className="p-1">{r.ref}</td><td className="p-1">{r.title}</td><td className="p-1">{r.valid ? 'OK' : r.errors.join('; ')}</td></tr>))}</tbody></table></div>
        <div className="mt-3"><button className="btn" disabled={!prev.counts.valid || a.busy} onClick={confirmImport}>3. Import {prev.counts.valid} valid row(s){prev.counts.invalid ? ` (skip ${prev.counts.invalid})` : ''}</button></div></div>}</>}</Modal>);
}

// ---------------- release viewer / draft editor ----------------
function ControlForm({ releaseId, existing, onDone }: { releaseId: string; existing?: any; onDone: () => void }) {
  const a = useDo(); const [f, setF] = useState({ ref: existing?.ref ?? '', domain: existing?.domain ?? '', title: existing?.title ?? '', description: existing?.description ?? '', ownerDepartment: existing?.owner_department ?? '' });
  const submit = (e: FormEvent) => { e.preventDefault(); a.run(async () => { const body = { ...f, description: f.description || null, ownerDepartment: f.ownerDepartment || null }; if (existing) { const { ref, ...rest } = body; void ref; await api('PATCH', `/releases/${releaseId}/controls/${existing.id}`, rest); } else await api('POST', `/releases/${releaseId}/controls`, body); onDone(); }); };
  return (<form onSubmit={submit} className="grid gap-1 sm:grid-cols-2">{a.err && <div className="sm:col-span-2"><ErrorBox message={a.err} /></div>}
    <Field label="Control ID" value={f.ref} onChange={e => setF({ ...f, ref: e.target.value })} required disabled={!!existing} /><Field label="Domain / clause" value={f.domain} onChange={e => setF({ ...f, domain: e.target.value })} required />
    <div className="sm:col-span-2"><Field label="Requirement" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} required /></div><Field label="Owner (department)" value={f.ownerDepartment} onChange={e => setF({ ...f, ownerDepartment: e.target.value })} />
    <Field label="Evidence / reference" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /><div className="sm:col-span-2"><button className="btn" disabled={a.busy}>{existing ? 'Save control' : 'Add control'}</button></div></form>);
}
export function ReleasePage() {
  const { id } = useParams(); const { me } = useAuth(); const admin = isAdmin(me?.user.platformRole); const qc = useQueryClient(); const nav = useNavigate(); const a = useDo(); const [hist, setHist] = useState<any>(null); const [reqFor, setReqFor] = useState<null | { control: any; commonControlId: string | null }>(null);
  const [modal, setModal] = useState<null | 'add' | 'import' | 'publish' | { edit: any }>(null); const [confirmText, setConfirmText] = useState('');
  const rel = useQuery({ queryKey: ['release', id], queryFn: () => api<any>('GET', `/releases/${id}`) }); const ctl = useQuery({ queryKey: ['controls', id], queryFn: () => api<any[]>('GET', `/releases/${id}/controls`) });
  const cc = useQuery({ queryKey: ['common-controls'], queryFn: () => api<any[]>('GET', '/common-controls') }); const fw = useQuery({ queryKey: ['framework', rel.data?.frameworkId], queryFn: () => api<any>('GET', `/frameworks/${rel.data.frameworkId}`), enabled: !!rel.data });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['controls', id] }); qc.invalidateQueries({ queryKey: ['release', id] }); qc.invalidateQueries({ queryKey: ['frameworks'] }); qc.invalidateQueries({ queryKey: ['framework'] }); qc.invalidateQueries({ queryKey: ['common-controls'] }); };
  if (rel.isLoading || ctl.isLoading) return <Spinner />; if (rel.isError) return <ErrorBox message={msg(rel.error)} />; const r = rel.data; const draft = r.status === 'draft' && admin && !r.archived; const groups = groupByDomain(ctl.data ?? []);
  const others = (fw.data?.releases ?? []).filter((x: any) => x.id !== id);
  return (<div className="grid gap-4"><div><Link to={`/frameworks/${r.frameworkId}`} className="text-sm text-brand underline">← {r.frameworkName}</Link>
    <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{r.frameworkName} · v{r.version}</h1><Badge tone={r.status === 'published' ? 'green' : 'amber'}>{r.status}</Badge>
      <div className="ml-auto flex flex-wrap gap-2">{others.length > 0 && <select aria-label="Compare with" className="rounded border px-2 py-1 text-sm" value="" onChange={e => e.target.value && nav(`/releases/${e.target.value}/compare/${id}`)}><option value="">Compare with…</option>{others.map((o: any) => <option key={o.id} value={o.id}>v{o.version} ({o.status})</option>)}</select>}
        {draft && <><button className="btn-secondary" onClick={() => setModal('add')}>Add control</button><button className="btn-secondary" onClick={() => setModal('import')}>Import CSV / Excel</button><button className="btn" disabled={!ctl.data?.length} onClick={() => setModal('publish')}>Publish…</button></>}</div></div>
    {r.status === 'published' && <p className="text-sm text-slate-600">This release is published and cannot be changed. To change content, create a new draft release from the framework page.</p>}</div>
    {a.err && <ErrorBox message={a.err} />}
    {!groups.length ? <Empty>This release has no controls yet.{draft ? ' Add controls or import a spreadsheet.' : ''}</Empty> : groups.map(g => (<section key={g.domain} className="card"><h2 className="mb-2 font-semibold">{g.domain} <span className="text-xs font-normal text-slate-500">{g.items.length} controls</span></h2>
      <table className="w-full text-sm"><tbody>{g.items.map(c => (<tr key={c.id} className="border-t align-top"><td className="w-24 py-1 pr-2 font-mono text-xs">{c.ref}</td><td className="py-1 pr-2">{c.title}{c.owner_department && <div className="text-xs text-slate-500">Owner: {c.owner_department}</div>}</td>
        <td className="w-56 py-1 pr-2">{admin ? <select aria-label={`Common control for ${c.ref}`} className="w-full rounded border px-1 py-0.5 text-xs" value={c.common_control_id ?? ''} disabled={r.archived} onChange={e => { const v = e.target.value; a.run(async () => { try { if (v) await api('PUT', `/controls/${c.id}/mapping`, { commonControlId: v }); else await api('DELETE', `/controls/${c.id}/mapping`); } catch (err) { if ((err as any)?.code === 'approval_required') { setReqFor({ control: c, commonControlId: v || null }); return; } throw err; } refresh(); }); }}>
          <option value="">— not mapped —</option>{(cc.data ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.title}</option>)}</select> : c.common_control_title ? <Badge tone="brand">{c.common_control_title}</Badge> : null}</td>
        <td className="w-40 py-1 text-right">{admin && <button className="btn-secondary mr-1" aria-label={`Mapping history of ${c.ref}`} onClick={() => setHist(c)}>History</button>}{draft && <><button className="btn-secondary mr-1" onClick={() => setModal({ edit: c })}>Edit</button><button className="btn-secondary" aria-label={`Delete ${c.ref}`} onClick={() => confirm(`Delete ${c.ref}?`) && a.run(async () => { await api('DELETE', `/releases/${id}/controls/${c.id}`); refresh(); })}>Delete</button></>}</td></tr>))}</tbody></table></section>))}
    {hist && <MappingHistoryDialog controlId={hist.id} title={hist.ref} onClose={() => setHist(null)} />}
    {reqFor && <Modal title="Submit mapping change for approval" onClose={() => setReqFor(null)}><MappingRequestForm control={reqFor.control} commonControlId={reqFor.commonControlId} commonTitle={(cc.data ?? []).find((x: any) => x.id === reqFor.commonControlId)?.title ?? null} onDone={() => { setReqFor(null); refresh(); }} /></Modal>}
    {modal === 'add' && <Modal title="Add control" onClose={() => setModal(null)}><ControlForm releaseId={id!} onDone={() => { setModal(null); refresh(); }} /></Modal>}
    {modal && typeof modal === 'object' && <Modal title={`Edit ${modal.edit.ref}`} onClose={() => setModal(null)}><ControlForm releaseId={id!} existing={modal.edit} onDone={() => { setModal(null); refresh(); }} /></Modal>}
    {modal === 'import' && <ImportWizard releaseId={id!} onClose={() => setModal(null)} onDone={refresh} />}
    {modal === 'publish' && <Modal title={`Publish v${r.version}`} onClose={() => setModal(null)}><p className="mb-2 text-sm">Publishing makes this release <b>permanent and read-only</b> ({ctl.data?.length} controls). Engagements will be built from published releases only. To change it later you create a new draft release.</p>
      <Field label='Type "publish" to confirm' value={confirmText} onChange={e => setConfirmText(e.target.value)} />{a.err && <ErrorBox message={a.err} />}
      <button className="btn" disabled={confirmText !== 'publish' || a.busy} onClick={() => a.run(async () => { await api('POST', `/releases/${id}/publish`); setModal(null); refresh(); })}>Publish release</button></Modal>}</div>);
}

// ---------------- comparison ----------------
export function ComparePage() {
  const { id, otherId } = useParams(); const q = useQuery({ queryKey: ['compare', id, otherId], queryFn: () => api<any>('GET', `/releases/${id}/compare/${otherId}`) });
  if (q.isLoading) return <Spinner />; if (q.isError) return <ErrorBox message={msg(q.error)} />; const d = q.data; const Sec = ({ title, tone, children, n }: { title: string; tone: 'green' | 'red' | 'amber'; children: ReactNode; n: number }) => (<section className="card"><h2 className="mb-2 font-semibold"><Badge tone={tone}>{n}</Badge> {title}</h2>{n ? children : <Empty>None.</Empty>}</section>);
  return (<div className="grid gap-4"><h1 className="text-xl font-semibold">Compare v{d.from.version} → v{d.to.version}</h1><p className="text-sm text-slate-600">{d.summary.added} added · {d.summary.removed} removed · {d.summary.changed} changed · {d.summary.unchanged} unchanged. Results are deterministic (sorted by control ID).</p>
    <Sec title="Added in the newer release" tone="green" n={d.added.length}><ul className="text-sm">{d.added.map((x: any) => <li key={x.ref}><span className="font-mono text-xs">{x.ref}</span> {x.title}</li>)}</ul></Sec>
    <Sec title="Removed in the newer release" tone="red" n={d.removed.length}><ul className="text-sm">{d.removed.map((x: any) => <li key={x.ref}><span className="font-mono text-xs">{x.ref}</span> {x.title}</li>)}</ul></Sec>
    <Sec title="Changed" tone="amber" n={d.changed.length}>{d.changed.map((x: any) => (<div key={x.ref} className="mb-2 border-t pt-2 text-sm"><span className="font-mono text-xs">{x.ref}</span>{x.changes.map((c: any) => <div key={c.field} className="text-xs"><b>{c.field}</b>: <span className="text-red-700 line-through">{c.from ?? '—'}</span> → <span className="text-green-700">{c.to ?? '—'}</span></div>)}</div>))}</Sec></div>);
}

// ---------------- common controls ----------------
export function CommonControlsPage() {
  const { me } = useAuth(); const admin = isAdmin(me?.user.platformRole); const qc = useQueryClient(); const a = useDo(); const [f, setF] = useState({ title: '', description: '' }); const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['common-controls'], queryFn: () => api<any[]>('GET', '/common-controls') }); const detail = useQuery({ queryKey: ['common-control', open], queryFn: () => api<any>('GET', `/common-controls/${open}`), enabled: !!open });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['common-controls'] }); qc.invalidateQueries({ queryKey: ['common-control'] }); };
  const create = (e: FormEvent) => { e.preventDefault(); a.run(async () => { await api('POST', '/common-controls', { title: f.title, description: f.description || null }); setF({ title: '', description: '' }); refresh(); }); };
  return (<div className="grid gap-4"><h1 className="text-xl font-semibold">Common controls</h1><p className="text-sm text-slate-600">A common control is one requirement that several frameworks share. When an engagement covers several frameworks, evidence is collected once per common control. Map controls from a release's page.</p>
    {admin && <form onSubmit={create} className="card flex flex-wrap items-end gap-2"><div className="min-w-[14rem] flex-1"><Field label="Title" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} required /></div><div className="min-w-[14rem] flex-1"><Field label="Description" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></div><button className="btn mb-3" disabled={a.busy}>Add common control</button></form>}
    {a.err && <ErrorBox message={a.err} />}
    {q.isLoading ? <Spinner /> : q.isError ? <ErrorBox message={msg(q.error)} /> : !q.data!.length ? <Empty>No common controls yet.</Empty> : q.data!.map(c => (<section key={c.id} className="card"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{c.title}</h2><Badge>{c.mappedCount} mapped · {c.frameworkCount} frameworks</Badge>
      <div className="ml-auto flex gap-2"><button className="btn-secondary" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'Hide' : 'Show mapped controls'}</button>
        {admin && <button className="btn-secondary" onClick={() => confirm(`Delete "${c.title}"?`) && a.run(async () => { await api('DELETE', `/common-controls/${c.id}`); refresh(); })}>Delete</button>}</div></div>{c.description && <p className="text-sm text-slate-600">{c.description}</p>}
      {open === c.id && (detail.isLoading ? <Spinner /> : !detail.data?.controls.length ? <Empty>No controls mapped yet.</Empty> : <ul className="mt-2 text-sm">{detail.data.controls.map((m: any) => <li key={m.controlId} className="border-t py-1"><span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: m.color }} />{m.frameworkName} v{m.version} · <span className="font-mono text-xs">{m.ref}</span> {m.title}{m.releaseStatus === 'draft' && <> <Badge tone="amber">draft</Badge></>}</li>)}</ul>)}</section>))}</div>);
}

/** Shown when the approval policy is on and a published mapping is changed: the change becomes a request that a second administrator decides. */
export function MappingRequestForm({ control, commonControlId, commonTitle, onDone }: { control: any; commonControlId: string | null; commonTitle: string | null; onDone: () => void }) {
  const a = useDo(); const [why, setWhy] = useState(''); const [sent, setSent] = useState(false);
  if (sent) return <div className="space-y-3"><p role="status" className="rounded bg-green-50 p-2 text-sm text-green-800">Request submitted. A second administrator must approve it before the mapping changes.</p><button className="btn" onClick={onDone}>Close</button></div>;
  return (<form className="space-y-3" onSubmit={e => { e.preventDefault(); a.run(async () => { await api('POST', `/controls/${control.id}/mapping-requests`, { commonControlId, rationale: why }); setSent(true); }); }}>
    <p className="text-sm">This framework release is published, so mapping changes need approval. Request: <b>{control.ref}</b> {commonControlId ? <>→ <b>{commonTitle ?? 'selected common control'}</b></> : <>→ <b>remove the mapping</b></>}.</p>
    <label className="block text-sm font-medium">Reason<textarea className="input" rows={3} minLength={3} required value={why} onChange={e => setWhy(e.target.value)} /></label>
    {a.err && <ErrorBox message={a.err} />}<button className="btn" disabled={a.busy}>Submit for approval</button></form>);
}
