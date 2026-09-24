import { CheckCircle2, Info, Trophy, TriangleAlert, XCircle } from 'lucide-react';
import { useEffect } from 'react';
import { create } from 'zustand';
import { cn } from './cn';

export type ToastTone = 'info' | 'success' | 'error' | 'warning' | 'achievement';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
  /** ms before auto-dismiss (default 4000; 0 = sticky). */
  duration?: number;
}

interface ToastStore {
  toasts: Toast[];
  push(t: Omit<Toast, 'id'>): number;
  dismiss(id: number): void;
}

let nextId = 1;

export const useToasts = create<ToastStore>((set) => ({
  toasts: [],
  push: (t) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { ...t, id }] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Show a toast from anywhere (outside React too). */
export function toast(t: Omit<Toast, 'id'>): number {
  return useToasts.getState().push(t);
}

const ICONS = {
  info: <Info size={18} className="text-sky-400" />,
  success: <CheckCircle2 size={18} className="text-emerald-400" />,
  error: <XCircle size={18} className="text-red-400" />,
  warning: <TriangleAlert size={18} className="text-amber-400" />,
  achievement: <Trophy size={18} className="text-yellow-300" />,
};

function ToastItem({ t }: { t: Toast }) {
  const dismiss = useToasts((s) => s.dismiss);
  useEffect(() => {
    const ms = t.duration ?? 4000;
    if (ms === 0) return;
    const h = window.setTimeout(() => dismiss(t.id), ms);
    return () => window.clearTimeout(h);
  }, [t, dismiss]);
  return (
    <div
      role="status"
      onClick={() => dismiss(t.id)}
      className={cn(
        'pointer-events-auto flex w-80 cursor-pointer gap-3 rounded-xl border bg-panel-2/95 p-3 shadow-xl backdrop-blur',
        'animate-[toast-in_220ms_ease-out]',
        t.tone === 'achievement' ? 'border-yellow-400/40 shadow-yellow-900/30' : 'border-edge',
      )}
    >
      <div className="pt-0.5">{ICONS[t.tone]}</div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-100">{t.title}</div>
        {t.body && <div className="mt-0.5 text-xs text-slate-400">{t.body}</div>}
      </div>
    </div>
  );
}

/** Mount once near the app root. */
export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex flex-col items-end gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} />
      ))}
    </div>
  );
}
