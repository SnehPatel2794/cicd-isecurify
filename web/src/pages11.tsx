// Import scanner / VAPT results into an engagement's findings (Phase 8C): choose a file, review the preview, confirm.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api'; import { ErrorBox, Spinner } from './ui'; import { Badge, Modal, useDo } from './kit'; import { SeverityBadge } from './pages7';
import { formatOf, summaryLine, canCommit, STATUS_TEXT } from './importUi';
const TONE: Record<string, 'green' | 'slate' | 'red'> = { new: 'green', duplicate: 'slate', invalid: 'red' };

export function ImportDialog({ tid, eid, onClose, onDone }: { tid: string; eid: string; onClose: () => void; onDone: () => void }) {
  const a = useDo(); const items = useQuery({ queryKey: ['import-items', tid, eid], queryFn: () => api<any>('GET', `/t/${tid}/engagements/${eid}/checklist`) });
  const [file, setFile] = useState<null | { name: string; format: 'csv' | 'json'; content: string }>(null); const [def, setDef] = useState(''); const [pre, setPre] = useState<any>(null); const [skip, setSkip] = useState(false); const [done, setDone] = useState<any>(null); const [round, setRound] = useState('');
  const vr = useQuery({ queryKey: ['vapt', tid, eid], queryFn: () => api<any>('GET', `/t/${tid}/engagements/${eid}/vapt`), retry: false }); const liveRounds: any[] = Array.isArray(vr.data?.rounds) ? vr.data.rounds.filter((r: any) => !['closed', 'cancelled'].includes(r.status)) : [];
  const body = (f: NonNullable<typeof file>, d: string, commit: boolean) => ({ format: f.format, filename: f.name, content: f.content, defaultItemRef: d || undefined, roundId: round || undefined, commit, skipInvalid: skip });
  const preview = (f: NonNullable<typeof file>, d: string) => a.run(async () => { setPre(null); setPre(await api('POST', `/t/${tid}/engagements/${eid}/findings/import`, body(f, d, false))); });
  const choose = async (fl: File | undefined) => { setPre(null); setFile(null); if (!fl) return; const format = formatOf(fl.name); if (!format) { a.run(async () => { throw new Error('Choose a .csv or .json file'); }); return; }
    const f = { name: fl.name, format, content: await fl.text() }; setFile(f); preview(f, def); };
  const commit = () => a.run(async () => { const r = await api('POST', `/t/${tid}/engagements/${eid}/findings/import`, body(file!, def, true)); setDone(r); onDone(); });
  const opts: any[] = (items.data?.items ?? []).filter((i: any) => i.readiness !== 'not_applicable');
  return (<Modal title="Import scan results" onClose={onClose} wide>
    {done ? <div className="space-y-3"><p role="status" className="rounded bg-green-50 p-3 text-sm text-green-800">Imported {done.willCreate} finding{done.willCreate === 1 ? '' : 's'}. {done.duplicates} skipped as already imported{done.invalid ? `, ${done.invalid} invalid skipped` : ''}.</p><button className="btn" onClick={onClose}>Close</button></div> : <div className="space-y-3">
      <p className="text-sm text-slate-600">Upload a CSV or JSON export from your scanner or penetration test (Nessus, ZAP, Burp style columns are recognised). Each row becomes a finding on a checklist item. Nothing is created until you confirm.</p>
      <label className="block text-sm font-medium">Results file<input className="input" type="file" accept=".csv,.json" aria-label="Results file" onChange={e => choose(e.target.files?.[0])} /></label>
      <label className="block text-sm font-medium">Checklist item for rows that do not name one<select className="input" aria-label="Default checklist item" value={def} onChange={e => { setDef(e.target.value); if (file) preview(file, e.target.value); }}><option value="">None (every row must name its item)</option>{items.isLoading ? null : opts.map((i: any) => <option key={i.id} value={i.ref}>{i.ref} — {i.title}</option>)}</select></label>
      {liveRounds.length > 0 && <label className="block text-sm font-medium">VAPT round (optional)<select className="input" aria-label="VAPT round" value={round} onChange={e => setRound(e.target.value)}><option value="">Not part of a round</option>{liveRounds.map((r: any) => <option key={r.id} value={r.id}>Round {r.roundNo}: {r.title}</option>)}</select></label>}
      {a.err && <ErrorBox message={a.err} />}{a.busy && !pre && <Spinner />}
      {pre && <div className="space-y-2"><p className="text-sm font-medium" role="status">{summaryLine(pre)}</p>
        <div className="max-h-72 overflow-auto rounded border"><table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-slate-500"><th className="p-1">Row</th><th>Title</th><th>Severity</th><th>Item</th><th>Result</th></tr></thead><tbody>
          {pre.rows.map((r: any) => <tr key={r.row} className="border-t"><td className="p-1">{r.row}</td><td>{r.title || '—'}</td><td>{r.severity ? <SeverityBadge severity={r.severity} /> : '—'}</td><td>{r.itemRef ?? '—'}</td><td><Badge tone={TONE[r.status]}>{STATUS_TEXT[r.status]}</Badge>{r.message && <span className="ml-2 text-xs text-red-700">{r.message}</span>}</td></tr>)}</tbody></table></div>
        {pre.total > pre.rows.length && <p className="text-xs text-slate-500">Showing the first {pre.rows.length} rows.</p>}
        {pre.invalid > 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={skip} onChange={e => setSkip(e.target.checked)} />Skip the invalid rows and import the rest</label>}
        <button className="btn" disabled={a.busy || !canCommit(pre, skip)} onClick={commit}>Import {pre.willCreate} finding{pre.willCreate === 1 ? '' : 's'}</button></div>}
    </div>}</Modal>);
}
