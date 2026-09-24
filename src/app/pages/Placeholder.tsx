import { Construction } from 'lucide-react';

/** Temporary page body used while a page is being built. */
export function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
      <Construction size={40} className="text-safety" />
      <h1 className="text-2xl font-semibold text-slate-200">{title}</h1>
      <p>Under construction.</p>
    </div>
  );
}
