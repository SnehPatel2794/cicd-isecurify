import { BrandMark } from './branding'; import { ReactNode } from 'react';
export const Spinner = () => <div role="status" className="p-6 text-sm text-slate-500">Loading…</div>;
export const ErrorBox = ({ message }: { message: string }) => <p role="alert" className="mb-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{message}</p>;
export const Empty = ({ children }: { children: ReactNode }) => <p className="p-4 text-center text-sm text-slate-500">{children}</p>;
export const Field = ({ label, ...p }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) => (<label className="block text-sm font-medium text-slate-700">{label}<input className="input" {...p} /></label>);
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (<main className="mx-auto mt-16 max-w-md px-4"><div className="mb-6 text-center text-2xl font-semibold text-brand"><BrandMark /></div><div className="card"><h1 className="mb-4 text-lg font-semibold">{title}</h1>{children}</div></main>);
}
