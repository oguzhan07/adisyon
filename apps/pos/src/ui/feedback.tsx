import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';

/* ------------------------------------------------------------------ Toast */

type ToastKind = 'ok' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

/* -------------------------------------------------------------- Onay diyalogu */

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  /** Sebep zorunluysa: kullanicidan metin ister, onExtra ile geri verir */
  requireReason?: boolean;
  reasonLabel?: string;
}

interface FeedbackApi {
  toast: (message: string, kind?: ToastKind) => void;
  /** Geri alinamaz islemler icin onay. requireReason ise sebep dondurur. */
  confirm: (options: ConfirmOptions) => Promise<{ ok: boolean; reason?: string }>;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

export function useFeedback(): FeedbackApi {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useFeedback FeedbackProvider içinde kullanılmalı');
  return ctx;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (result: { ok: boolean; reason?: string }) => void;
}

/**
 * Uygulama genelinde bildirim ve onay. Onay diyalogu SADECE geri alinamaz
 * islemlerde kullanilir (kalem iptali, adisyon kapatma, sayim uygulama);
 * normal ekle/cikar sorusuz calisir.
 */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [reason, setReason] = useState('');

  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, kind, message }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4000);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    setReason('');
    return new Promise<{ ok: boolean; reason?: string }>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  const api = useMemo<FeedbackApi>(() => ({ toast, confirm }), [toast, confirm]);

  function closeConfirm(ok: boolean) {
    if (!pending) return;
    if (ok && pending.requireReason && reason.trim() === '') return; // sebep zorunlu
    pending.resolve({ ok, reason: reason.trim() || undefined });
    setPending(null);
  }

  return (
    <FeedbackContext.Provider value={api}>
      {children}

      {/* Bildirimler */}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={[
              'pointer-events-auto rounded-(--radius-control) px-4 py-3 text-sm shadow-lg',
              t.kind === 'error'
                ? 'bg-(--color-status-alert) text-white'
                : t.kind === 'ok'
                  ? 'bg-(--color-status-ready) text-white'
                  : 'bg-(--color-text) text-(--color-text-inverse)',
            ].join(' ')}
          >
            {t.message}
          </div>
        ))}
      </div>

      {/* Onay diyalogu */}
      <Modal
        open={!!pending}
        onClose={() => closeConfirm(false)}
        title={pending?.title ?? ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => closeConfirm(false)}>
              Vazgeç
            </Button>
            <Button
              variant={pending?.danger ? 'danger' : 'primary'}
              onClick={() => closeConfirm(true)}
            >
              {pending?.confirmLabel ?? 'Onayla'}
            </Button>
          </>
        }
      >
        <p className="text-(--color-text)">{pending?.message}</p>
        {pending?.requireReason && (
          <div className="mt-4">
            <label className="mb-1.5 block text-sm font-medium text-(--color-text-muted)">
              {pending.reasonLabel ?? 'Sebep'}
            </label>
            <input
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full min-h-12 rounded-(--radius-control) border border-(--color-border-strong) bg-(--color-surface-raised) px-3 text-base"
              placeholder="Kısa bir açıklama girin"
            />
          </div>
        )}
      </Modal>
    </FeedbackContext.Provider>
  );
}
