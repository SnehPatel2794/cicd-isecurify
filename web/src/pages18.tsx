// Branding (Phase 10B): the platform owner sets the company name, colours, logo and footer text used on screens, PDFs, certificates and emails.
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiUpload } from './api'; import { ErrorBox, Spinner } from './ui'; import { useDo } from './kit';
import { DEFAULTS, isHex, primaryProblem, logoProblem, logoUrl, sameProfile, brandVars, type Profile } from './brandingUi';

function ColourField({ label, value, onChange, problem }: { label: string; value: string; onChange: (v: string) => void; problem?: string | null }) {
  return (<div className="text-sm font-medium text-slate-700"><span id={`l-${label.replace(/ /g, "-")}`}>{label}</span>
    <div className="mt-1 flex items-center gap-2"><input type="color" aria-label={`${label} picker`} value={isHex(value) ? value : '#000000'} onChange={e => onChange(e.target.value.toLowerCase())} className="h-9 w-12 cursor-pointer rounded border" />
      <input aria-labelledby={`l-${label.replace(/ /g, "-")}`} className="input w-32" value={value} maxLength={7} onChange={e => onChange(e.target.value.trim().toLowerCase())} /></div>
    {!isHex(value) ? <p className="mt-1 text-xs text-red-700">Use a colour like #812671</p> : problem ? <p role="alert" className="mt-1 text-xs text-red-700">{problem}</p> : null}</div>);
}
export function BrandingPage() {
  const qc = useQueryClient(); const a = useDo(); const lg = useDo();
  const q = useQuery({ queryKey: ['branding-admin'], queryFn: () => api<Profile & { logo: any }>('GET', '/platform/branding') });
  const [f, setF] = useState<Profile>(DEFAULTS); const [saved, setSaved] = useState(false);
  useEffect(() => { if (q.data) setF({ ...DEFAULTS, ...q.data }); }, [q.data]);
  if (q.isLoading) return <Spinner />; if (q.error || !q.data) return <ErrorBox message="The branding settings could not be loaded." />;
  const cur: Profile = { ...DEFAULTS, ...q.data }; const set = (k: keyof Profile, v: string) => { setSaved(false); setF({ ...f, [k]: v }); };
  const pProblem = primaryProblem(f.primaryColor); const valid = f.companyName.trim().length > 0 && isHex(f.secondaryColor) && isHex(f.accentColor) && !pProblem; const dirty = !sameProfile(f, cur);
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ['branding-admin'] }); await qc.invalidateQueries({ queryKey: ['branding'] }); };
  const save = () => a.run(async () => { await api('PUT', '/platform/branding', { companyName: f.companyName.trim(), primaryColor: f.primaryColor, secondaryColor: f.secondaryColor, accentColor: f.accentColor, footerText: f.footerText }); await refresh(); setSaved(true); });
  const upload = (file?: File | null) => { if (!file) return; const p = logoProblem(file); if (p) { lg.setErr(p); return; } lg.run(async () => { await apiUpload('/platform/branding/logo', file); await refresh(); }); };
  const removeLogo = () => lg.run(async () => { await api('DELETE', '/platform/branding/logo'); await refresh(); });
  const vars = brandVars(isHex(f.primaryColor) ? f.primaryColor : DEFAULTS.primaryColor);
  return (<div className="max-w-4xl"><h1 className="mb-1 text-xl font-semibold">Branding</h1><p className="mb-4 text-sm text-slate-600">Shown on every screen, report, certificate and email. Changes apply to documents the next time they are produced.</p>
    <div className="grid gap-4 md:grid-cols-2">
      <section className="card space-y-3" aria-label="Settings">{a.err && <ErrorBox message={a.err} />}
        <label className="block text-sm font-medium text-slate-700">Company name<input className="input mt-1" value={f.companyName} maxLength={80} onChange={e => set('companyName', e.target.value)} /></label>
        <ColourField label="Primary colour" value={f.primaryColor} onChange={v => set('primaryColor', v)} problem={pProblem} />
        <ColourField label="Secondary colour" value={f.secondaryColor} onChange={v => set('secondaryColor', v)} />
        <ColourField label="Accent colour" value={f.accentColor} onChange={v => set('accentColor', v)} />
        <label className="block text-sm font-medium text-slate-700">Footer text<input className="input mt-1" value={f.footerText} maxLength={200} placeholder="For example: Confidential. Registered address…" onChange={e => set('footerText', e.target.value)} /></label>
        <div className="flex items-center gap-2"><button className="btn" disabled={!valid || !dirty || a.busy} onClick={save}>Save</button><button className="btn-secondary" disabled={a.busy} onClick={() => { setSaved(false); setF({ ...DEFAULTS, hasLogo: cur.hasLogo, version: cur.version }); }}>Use the standard colours</button>{saved && !dirty && <span role="status" className="text-sm text-green-700">Saved</span>}</div></section>
      <section className="card space-y-3" aria-label="Logo">{lg.err && <ErrorBox message={lg.err} />}<h2 className="font-semibold">Logo</h2>
        {cur.hasLogo ? <img src={logoUrl(cur.version)} alt="Current logo" className="max-h-20 max-w-full object-contain" /> : <p className="text-sm text-slate-500">No logo. The company name is shown instead.</p>}
        <label className="block text-sm font-medium text-slate-700">Upload a logo (PNG or JPG, up to 2 MB)<input type="file" accept="image/png,image/jpeg" className="mt-1 block text-sm" disabled={lg.busy} onChange={e => { upload(e.target.files?.[0]); e.target.value = ''; }} /></label>
        {cur.hasLogo && <button className="btn-secondary" disabled={lg.busy} onClick={removeLogo}>Remove logo</button>}</section></div>
    <section className="mt-4" aria-label="Preview"><h2 className="mb-2 font-semibold">Preview</h2>
      <div className="rounded-md border bg-white p-6" style={vars as any}><div className="h-2 rounded" style={{ background: isHex(f.primaryColor) ? f.primaryColor : DEFAULTS.primaryColor }} />
        <div className="mt-4 flex items-center gap-3">{cur.hasLogo ? <img src={logoUrl(cur.version)} alt="" className="max-h-10" /> : null}<div className="text-lg font-semibold" style={{ color: isHex(f.primaryColor) ? f.primaryColor : DEFAULTS.primaryColor }}>{f.companyName || '—'}</div></div>
        <p className="mt-3 text-sm text-slate-600">Assessment report · Certificate of completion</p>
        <div className="mt-3 flex gap-2"><span className="rounded px-3 py-1 text-sm text-white" style={{ background: isHex(f.primaryColor) ? f.primaryColor : DEFAULTS.primaryColor }}>Button</span><span className="rounded px-3 py-1 text-sm text-white" style={{ background: isHex(f.secondaryColor) ? f.secondaryColor : DEFAULTS.secondaryColor }}>Secondary</span><span className="rounded px-3 py-1 text-sm text-white" style={{ background: isHex(f.accentColor) ? f.accentColor : DEFAULTS.accentColor }}>Accent</span></div>
        {f.footerText && <p className="mt-4 border-t pt-2 text-xs text-slate-500">{f.footerText}</p>}</div></section></div>);
}
