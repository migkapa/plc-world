import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Prevent closing with Escape / backdrop click. */
  persistent?: boolean;
  className?: string;
}

/** Centered dialog rendered in a portal. */
export function Modal({ open, onClose, title, children, footer, size = 'md', persistent, className }: ModalProps) {
  useEffect(() => {
    if (!open || persistent) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, persistent, onClose]);

  if (!open) return null;
  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (!persistent && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn('flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-edge bg-panel-2 shadow-2xl', width, className)}
      >
        {title && (
          <header className="flex items-center gap-3 border-b border-edge px-5 py-3">
            <h2 className="min-w-0 flex-1 text-lg font-semibold">{title}</h2>
            {!persistent && (
              <button type="button" aria-label="Close" className="cursor-pointer rounded p-1 text-slate-400 hover:bg-white/5 hover:text-white" onClick={onClose}>
                <X size={18} />
              </button>
            )}
          </header>
        )}
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-edge px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
