// Outgoing email administration (Phase 7A). Platform administrators see whether email is configured, send a test message and read the delivery log.
// The log never holds a message body, a link or a token, so nothing sensitive can appear here.
import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api'; import { Empty, ErrorBox, Field, Spinner } from './ui'; import { Badge, useDo } from './kit';

export const useEmailStatus = (status: '' | 'sent' | 'failed') => useQuery({ queryKey: ['email', status], queryFn: () => api<any>('GET', `/platform/email${status ? `?status=${status}` : ''}`), keepPreviousData: true } as any);
const TLS_TEXT: Record<string, string> = { starttls: 'STARTTLS (encrypted, required)', tls: 'Implicit TLS (encrypted)', none: 'No encryption (development only)' };

export function EmailPage() {
  const qc = useQueryClient(); const a = useDo(); const [filter, setFilter] = useState<'' | 'sent' | 'failed'>(''); const [to, setTo] = useState(''); const [info, setInfo] = useState('');
  const q: any = useEmailStatus(filter);
  if (q.isLoading) return <Spinner />; if (q.isError || !q.data) return <ErrorBox message="Could not load the email settings" />;
  const s = q.data; const send = (e: FormEvent) => { e.preventDefault(); a.run(async () => { setInfo(''); await api('POST', '/platform/email/test', { to }); setInfo(`Test message queued for ${to}. It is sent within a few seconds; refresh the log to see the result.`); qc.invalidateQueries({ queryKey: ['email'] }); }); };
  return (<div className="space-y-4"><div className="flex items-center gap-3"><h1 className="text-xl font-semibold">Email delivery</h1>
      <Badge tone={s.configured ? 'green' : 'red'}>{s.configured ? 'Configured' : 'Not configured'}</Badge></div>
    <section className="card space-y-1 text-sm" aria-label="Configuration">
      {s.configured ? <dl className="grid grid-cols-[10rem_1fr] gap-y-1"><dt className="text-slate-500">Server</dt><dd>{s.host}:{s.port}</dd><dt className="text-slate-500">Encryption</dt><dd>{TLS_TEXT[s.tls] ?? s.tls}</dd><dt className="text-slate-500">Sent from</dt><dd>{s.from}</dd><dt className="text-slate-500">Links point to</dt><dd>{s.origin ?? '—'}</dd></dl>
        : <p>Outgoing email is not set up. Invitations and password resets cannot be delivered until <code>SMTP_HOST</code> and <code>MAIL_FROM</code> are set on the server (see docs/EMAIL.md). Credentials are never shown here.</p>}
      <p className="pt-2 text-slate-600">Queue: {s.queue.pending} waiting, {s.queue.running} sending, {s.queue.dead} given up.{s.lastResult && <> Last delivery attempt: <Badge tone={s.lastResult.status === 'sent' ? 'green' : 'red'}>{s.lastResult.status}</Badge> at {new Date(s.lastResult.createdAt).toLocaleString()}.</>}</p>
      {s.outbox && <div aria-label="Event queue" className="pt-2 text-slate-600">Event queue: {s.outbox.pending} waiting, {s.outbox.dead} parked after repeated failures.
        {s.outbox.dead > 0 && <><ul className="mt-1 list-disc pl-5 text-xs">{s.outbox.deadEvents.map((e: any) => <li key={e.id}>{e.type}: {e.lastError ?? 'unknown error'} ({e.attempts} tries)</li>)}</ul>
          <button className="btn-secondary mt-2" disabled={a.busy} onClick={() => a.run(async () => { const r = await api<{ retried: number }>('POST', '/platform/email/outbox/retry'); setInfo(`${r.retried} event${r.retried === 1 ? '' : 's'} put back in the queue.`); await qc.invalidateQueries({ queryKey: ['email'] }); })}>Retry parked events</button></>}</div>}</section>
    <form onSubmit={send} className="card flex flex-wrap items-end gap-3" aria-label="Send a test message"><div className="min-w-[16rem] flex-1"><Field label="Send a test message to" type="email" required value={to} onChange={e => setTo(e.target.value)} placeholder="you@example.com" /></div>
      <button className="btn" disabled={a.busy || !to}>Send test</button></form>
    {a.err && <ErrorBox message={a.err} />}{info && <p role="status" className="rounded bg-green-50 p-2 text-sm text-green-800">{info}</p>}
    <section className="card"><div className="mb-2 flex items-center gap-3"><h2 className="font-semibold">Delivery log</h2><select aria-label="Filter log" className="input ml-auto w-auto" value={filter} onChange={e => setFilter(e.target.value as any)}><option value="">All</option><option value="sent">Sent</option><option value="failed">Failed</option></select>
      <button className="btn-secondary" onClick={() => qc.invalidateQueries({ queryKey: ['email'] })}>Refresh</button></div>
      {!s.log.length ? <Empty>No messages yet.</Empty> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="text-xs uppercase text-slate-500"><th className="py-1">When</th><th>To</th><th>Subject</th><th>Result</th></tr></thead><tbody>
        {s.log.map((l: any) => <tr key={l.id} className="border-t"><td className="py-1 whitespace-nowrap">{new Date(l.createdAt).toLocaleString()}</td><td>{l.toEmail}</td><td>{l.subject}</td>
          <td>{l.status === 'sent' ? <Badge tone="green">Sent</Badge> : <span><Badge tone="red">Failed</Badge> <span className="text-xs text-slate-600">{l.error}</span></span>}</td></tr>)}</tbody></table></div>}
      <p className="mt-2 text-xs text-slate-500">The log shows the newest 100 messages. It records who and what, never the message text, links or one-time codes.</p></section></div>);
}
