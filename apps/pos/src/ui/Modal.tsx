import { useEffect, type ReactNode } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Genis icerik (adisyon secimi vb.) icin */
  wide?: boolean;
}

/**
 * Temel modal. Escape ile kapanir, arka plana tiklaninca kapanir.
 * Dokunmatik ekranda rahat kullanim icin genis ic bosluklar.
 */
export function Modal({ open, onClose, title, children, footer, wide }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className={[
          'flex max-h-[90vh] w-full flex-col overflow-hidden rounded-(--radius-card) bg-(--color-surface-raised) shadow-xl',
          wide ? 'max-w-3xl' : 'max-w-md',
        ].join(' ')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-(--color-border) px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="flex size-9 items-center justify-center rounded-(--radius-control) text-(--color-text-muted) hover:bg-(--color-surface-sunken)"
          >
            ✕
          </button>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div className="flex justify-end gap-3 border-t border-(--color-border) px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
