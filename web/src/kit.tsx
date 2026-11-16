// Small shared UI pieces for the engagement and evidence screens.
import { ReactNode, useState } from 'react'; import { ApiError } from './api';
export const msg = (e: unknown) => e instanceof ApiError ? e.message : 'Something went wrong';
/** Runs an async action with a busy flag and a visible error message. */
export function useDo() { const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => { setErr(''); setBusy(true); try { await fn(); } catch (e) { setErr(msg(e)); } finally { setBusy(false); } }; return { err, busy, run, setErr }; }
export const TONES = { slate: 'bg-slate-100 text-slate-700', green: 'bg-green-100 text-green-800', amber: 'bg-amber-100 text-amber-800', red: 'bg-red-100 text-red-800', brand: 'bg-brand-light text-brand' } as const;
export type Tone = keyof typeof TONES;
export const Badge = ({ children, tone = 'slate', title }: { children: ReactNode; tone?: Tone; title?: string }) => <span title={title} className={`rounded px-1.5 py-0.5 text-xs ${TONES[tone]}`}>{children}</span>;
export const Modal = ({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) => (<div role="dialog" aria-label={title} className="fixed inset-0 z-10 grid place-items-center bg-black/40 p-4"><div className={`card max-h-[90vh] w-full overflow-auto ${wide ? 'max-w-4xl' : 'max-w-lg'}`}><div className="mb-3 flex items-center"><h2 className="text-lg font-semibold">{title}</h2><button className="btn-secondary ml-auto" onClick={onClose}>Close</button></div>{children}</div></div>);
