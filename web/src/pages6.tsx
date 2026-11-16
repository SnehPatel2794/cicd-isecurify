// Evidence template library (Phase 5C). Everyone who belongs to an organization can download; iSecurify staff upload, edit and (admins) retire.
import { FormEvent, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiBlob, apiUpload, saveBlob } from './api'; import { useAuth } from './auth'; import { Empty, ErrorBox, Field, Spinner } from './ui'; import { Badge, Modal, useDo } from './kit';
import { fmtBytes, groupTemplates, sha256Hex, shortHash, templateOption } from './evidenceUi';

export const useTemplates = (includeRetired = false) => useQuery({ queryKey: ['templates', includeRetired], queryFn: () => api<any[]>('GET', `/templates${includeRetired ? '?includeRetired=true' : ''}`) });

/** Downloads a template and checks the bytes against the recorded SHA-256. Returns a message for the caller to show. */
export async function downloadTemplate(t: { id: string; fileName: string; sha256: string }): Promise<string> {
  const blob = await apiBlob(`/templates/${t.id}/download`); const h = await sha256Hex(await blob.arrayBuffer()); saveBlob(blob, t.fileName);
  return h === t.sha256 ? `Downloaded ${t.fileName}. SHA-256 matches.` : `WARNING: the downloaded file does not match the recorded SHA-256 of ${t.fileName}. Do not use it and tell an administrator.`;
}
/** Small button used inside evidence request cards. */
export function TemplateLink({ t }: { t: { id: string; name: string; fileName: string; sha256: string } }) {
  const a = useDo(); const [info, setInfo] = useState('');
  return (<span className="inline-flex items-center gap-2"><button className="btn-secondary" disabled={a.busy} onClick={() => a.run(async () => setInfo(await downloadTemplate(t)))}>Download template</button>{a.err && <span role="alert" className="text-xs text-red-700">{a.err}</span>}{info && <span role="status" className={`text-xs ${info.startsWith('WARNING') ? 'text-red-700' : 'text-green-700'}`}>{info}</span>}</span>);
}
/** Drop-down for request forms. Hidden when the library is empty or unreachable. */
export function TemplatePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const q = useTemplates(); if (q.isLoading || q.isError || !q.data?.length) return null;
  return (<label className="block text-sm font-medium">Template (optional)<select className="input" value={value} onChange={e => onChange(e.target.value)}><option value="">No template</option>{q.data.map(t => <option key={t.id} value={t.id}>{templateOption(t)}</option>)}</select></label>);
}

function UploadDialog({ onClose, replaces, onDone }: { onClose: () => void; replaces?: any; onDone: () => void }) {
  const a = useDo(); const file = useRef<HTMLInputElement>(null); const fw = useQuery({ queryKey: ['frameworks', false], queryFn: () => api<any[]>('GET', '/frameworks') });
  const [f, setF] = useState({ name: replaces?.name ?? '', category: replaces?.category ?? '', versionLabel: '', description: replaces?.description ?? '', frameworkId: replaces?.frameworkId ?? '' });
  const submit = (e: FormEvent) => { e.preventDefault(); const file0 = file.current?.files?.[0]; if (!file0) return a.setErr('Choose a file');
    a.run(async () => { const fields: Record<string, string> = { name: f.name }; for (const k of ['category', 'versionLabel', 'description', 'frameworkId'] as const) if (f[k]) fields[k] = f[k]; if (replaces) fields.replacesId = replaces.id;
      await apiUpload('/templates', file0, fields); onDone(); onClose(); }); };
  return (<Modal title={replaces ? 'Upload a new version' : 'Add a template'} onClose={onClose}><form onSubmit={submit} className="space-y-2" aria-label="Template upload">
    {replaces && <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">The current version of “{replaces.name}” will be retired. It stays available to the evidence requests that already use it.</p>}
    {a.err && <ErrorBox message={a.err} />}<Field label="Name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required maxLength={190} />
    <div className="grid gap-2 sm:grid-cols-2"><Field label="Category" value={f.category} onChange={e => setF({ ...f, category: e.target.value })} maxLength={80} /><Field label="Version label" value={f.versionLabel} onChange={e => setF({ ...f, versionLabel: e.target.value })} maxLength={40} /></div>
    <label className="block text-sm font-medium">Framework (optional)<select className="input" value={f.frameworkId} onChange={e => setF({ ...f, frameworkId: e.target.value })}><option value="">All frameworks</option>{(fw.data ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    <label className="block text-sm font-medium">Description<textarea className="input" rows={2} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></label>
    <label className="block text-sm font-medium">File<input ref={file} type="file" className="input" aria-label="Template file" /></label>
    <div className="flex gap-2"><button className="btn" disabled={a.busy || !f.name.trim()}>Upload</button><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button></div></form></Modal>);
}
function EditDialog({ t, onClose, onDone }: { t: any; onClose: () => void; onDone: () => void }) {
  const a = useDo(); const [f, setF] = useState({ name: t.name, category: t.category ?? '', versionLabel: t.versionLabel ?? '', description: t.description ?? '' });
  const submit = (e: FormEvent) => { e.preventDefault(); a.run(async () => { await api('PATCH', `/templates/${t.id}`, { name: f.name, category: f.category || null, versionLabel: f.versionLabel || null, description: f.description || null }); onDone(); onClose(); }); };
  return (<Modal title="Edit template details" onClose={onClose}><form onSubmit={submit} className="space-y-2" aria-label="Edit template"><p className="text-xs text-slate-500">The file itself cannot be changed. Upload a new version instead.</p>{a.err && <ErrorBox message={a.err} />}
    <Field label="Name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required maxLength={190} /><div className="grid gap-2 sm:grid-cols-2"><Field label="Category" value={f.category} onChange={e => setF({ ...f, category: e.target.value })} maxLength={80} /><Field label="Version label" value={f.versionLabel} onChange={e => setF({ ...f, versionLabel: e.target.value })} maxLength={40} /></div>
    <label className="block text-sm font-medium">Description<textarea className="input" rows={2} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></label>
    <div className="flex gap-2"><button className="btn" disabled={a.busy || !f.name.trim()}>Save</button><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button></div></form></Modal>);
}

export function TemplatesPage() {
  const { me } = useAuth(); const role = me!.user.platformRole; const platform = role !== 'none'; const admin = role === 'super_admin' || role === 'admin'; const qc = useQueryClient(); const a = useDo();
  const [showRetired, setShowRetired] = useState(false); const [dlg, setDlg] = useState<null | { kind: 'new' } | { kind: 'replace' | 'edit'; t: any }>(null); const [info, setInfo] = useState(''); const [retire, setRetire] = useState<any>(null);
  const q = useTemplates(platform && showRetired); const refresh = () => qc.invalidateQueries({ queryKey: ['templates'] });
  const dl = (t: any) => a.run(async () => { setInfo(''); setInfo(await downloadTemplate(t)); });
  if (q.isLoading) return <Spinner />; if (q.isError) return <ErrorBox message="Could not load the templates" />;
  const groups = groupTemplates(q.data ?? []);
  return (<div className="space-y-4"><div className="flex flex-wrap items-center gap-3"><h1 className="text-xl font-semibold">Evidence templates</h1>
    {platform && <label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={showRetired} onChange={e => setShowRetired(e.target.checked)} />Show retired</label>}
    {platform && <button className={`btn ${showRetired ? '' : 'ml-auto'}`} onClick={() => setDlg({ kind: 'new' })}>Add template</button>}</div>
    <p className="text-sm text-slate-600">Blank forms, policies and checklists that evidence requests can point to. Every download is checked against the SHA-256 recorded at upload.</p>
    {a.err && <ErrorBox message={a.err} />}{info && <p role="status" className={`rounded p-2 text-sm ${info.startsWith('WARNING') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`}>{info}</p>}
    {!groups.length && <Empty>{platform ? 'No templates yet. Add the first one.' : 'No templates are available yet.'}</Empty>}
    {groups.map(g => (<section key={g.category} className="card" aria-label={`Category ${g.category}`}><h2 className="mb-2 font-semibold">{g.category}</h2>
      <table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-slate-500"><th>Template</th><th>File</th><th>Framework</th><th>SHA-256</th><th /></tr></thead><tbody>
        {g.items.map(t => (<tr key={t.id} className="border-t align-top"><td className="py-1.5"><div className="font-medium">{t.name} {t.versionLabel && <Badge>{t.versionLabel}</Badge>} {!t.active && <Badge tone="amber">Retired</Badge>}</div>{t.description && <div className="text-xs text-slate-600">{t.description}</div>}</td>
          <td>{t.fileName} <span className="text-xs text-slate-500">({fmtBytes(t.sizeBytes)})</span></td><td>{t.frameworkName ?? 'All'}</td><td className="font-mono text-xs">{shortHash(t.sha256)}</td>
          <td className="space-x-1 whitespace-nowrap text-right"><button className="btn-secondary" aria-label={`Download ${t.name}`} onClick={() => dl(t)} disabled={a.busy}>Download</button>
            {platform && !!t.active && <button className="btn-secondary" aria-label={`Edit ${t.name}`} onClick={() => setDlg({ kind: 'edit', t })}>Edit</button>}
            {platform && !!t.active && <button className="btn-secondary" aria-label={`New version of ${t.name}`} onClick={() => setDlg({ kind: 'replace', t })}>New version</button>}
            {admin && !!t.active && <button className="btn-secondary" aria-label={`Retire ${t.name}`} onClick={() => setRetire(t)}>Retire</button>}</td></tr>))}</tbody></table></section>))}
    {dlg?.kind === 'new' && <UploadDialog onClose={() => setDlg(null)} onDone={refresh} />}{dlg?.kind === 'replace' && <UploadDialog replaces={dlg.t} onClose={() => setDlg(null)} onDone={refresh} />}{dlg?.kind === 'edit' && <EditDialog t={dlg.t} onClose={() => setDlg(null)} onDone={refresh} />}
    {retire && <Modal title="Retire template" onClose={() => setRetire(null)}><p className="text-sm">Retire “{retire.name}”? It will no longer be offered for new requests. Existing requests keep their link, and nothing is deleted.</p><div className="mt-3 flex gap-2">
      <button className="btn" disabled={a.busy} onClick={() => a.run(async () => { await api('POST', `/templates/${retire.id}/retire`); setRetire(null); refresh(); })}>Retire</button><button className="btn-secondary" onClick={() => setRetire(null)}>Cancel</button></div></Modal>}</div>);
}
