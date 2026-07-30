import { useEffect, useState } from 'react';
import { DEFAULT_PRINTER_SETTINGS, type PrinterSettings } from '@adisyon/shared';
import { Button } from '../ui/Button';
import { Field, NumberInput, Select, TextInput, Toggle } from '../ui/Field';
import { useSettings, useUpdateSettings } from '../lib/settings';
import { describeError } from '../lib/supabase';

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; message: string }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string };

/**
 * Yazici ayarlari ve test.
 *
 * PROJENIN EN KRITIK EKRANI: Turkce karakterlerin termal yazicida dogru
 * basilmasi modele gore degisir ve onceden kesin bilinemez. "Test fişi bas"
 * dugmesi ilk kurulum gununde calistirilmali; bozuk karakter cikarsa
 * karakter seti degistirilip tekrar denenmeli.
 *
 * Ag baglantisi (Ethernet) onerilen yoldur: Windows yazici surucusune ve
 * oturum durumuna bagimli olmadigi icin belirgin sekilde daha kararlidir.
 */
export function PrinterSettingsScreen() {
  const { data: settings, isLoading } = useSettings();
  const updateSettings = useUpdateSettings();

  const [draft, setDraft] = useState<PrinterSettings>(DEFAULT_PRINTER_SETTINGS);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  // Ayarlar yuklendiginde formu doldur
  useEffect(() => {
    if (settings) setDraft(settings.printer);
  }, [settings]);

  function patch(changes: Partial<PrinterSettings>) {
    setDraft((current) => ({ ...current, ...changes }));
    setStatus({ kind: 'idle' });
  }

  async function save() {
    setStatus({ kind: 'busy', message: 'Kaydediliyor…' });
    try {
      await updateSettings.mutateAsync({ printer: draft });
      setStatus({ kind: 'ok', message: 'Yazıcı ayarları kaydedildi.' });
    } catch (error) {
      setStatus({ kind: 'error', message: describeError(error) });
    }
  }

  /** Fis basmadan yaziciya ulasilabildigini dogrular */
  async function checkConnection() {
    setStatus({ kind: 'busy', message: 'Yazıcıya bağlanılıyor…' });
    const connected = await window.desktop.print.testConnection(draft);

    setStatus(
      connected
        ? { kind: 'ok', message: 'Yazıcıya ulaşıldı.' }
        : {
            kind: 'error',
            message:
              'Yazıcıya ulaşılamadı. IP adresi, port ve ağ kablosunu kontrol edin. ' +
              '(USB bağlantısında bu sınama çalışmaz, doğrudan test fişi basın.)',
          },
    );
  }

  /** Turkce karakter + kesici + cekmece testini tek seferde yapar */
  async function printTest() {
    setStatus({ kind: 'busy', message: 'Test fişi gönderiliyor…' });
    const result = await window.desktop.print.test(draft, settings?.shop_name ?? 'Kokoreççi');

    setStatus(
      result.ok
        ? {
            kind: 'ok',
            message:
              'Test fişi gönderildi. Fişteki Türkçe karakterleri kontrol edin: ' +
              'ç ğ ı İ ö ş ü doğru basılmalı.',
          }
        : { kind: 'error', message: result.error ?? 'Yazdırma başarısız.' },
    );
  }

  if (isLoading) {
    return <p className="p-6 text-(--color-text-muted)">Yükleniyor…</p>;
  }

  const isNetwork = draft.connection === 'network';
  const isUsb = draft.connection === 'usb';

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-bold">Yazıcı</h1>
      <p className="mt-1 text-sm text-(--color-text-muted)">
        POSA 80mm termal yazıcı için ayarlar. Kurulumdan sonra mutlaka test fişi basın.
      </p>

      <div className="mt-6 space-y-5 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-5">
        <Field
          label="Bağlantı türü"
          hint="Ağ (Ethernet) önerilir: Windows yazıcı sürücüsünden bağımsız çalıştığı için daha kararlıdır."
        >
          <Select
            value={draft.connection}
            onChange={(event) =>
              patch({ connection: event.target.value as PrinterSettings['connection'] })
            }
          >
            <option value="network">Ağ (Ethernet / IP)</option>
            <option value="usb">USB (Windows paylaşılan yazıcı)</option>
            <option value="disabled">Yazıcı yok / kapalı</option>
          </Select>
        </Field>

        {isNetwork && (
          <div className="grid grid-cols-[1fr_140px] gap-4">
            <Field label="Yazıcı IP adresi" hint="Örn. 192.168.1.100">
              <TextInput
                value={draft.host ?? ''}
                placeholder="192.168.1.100"
                onChange={(event) => patch({ host: event.target.value.trim() || null })}
              />
            </Field>
            <Field label="Port" hint="Standart: 9100">
              <NumberInput
                value={draft.port}
                onChange={(event) => patch({ port: Number(event.target.value) || 9100 })}
              />
            </Field>
          </div>
        )}

        {isUsb && (
          <Field
            label="Windows paylaşım adı"
            hint={
              'Yazıcının Windows’ta paylaşıma açılmış olması gerekir. ' +
              'Denetim Masası > Yazıcılar > sağ tık > Yazıcı özellikleri > Paylaşım.'
            }
          >
            <TextInput
              value={draft.printerName ?? ''}
              placeholder="POSA80"
              onChange={(event) => patch({ printerName: event.target.value.trim() || null })}
            />
          </Field>
        )}

        {draft.connection !== 'disabled' && (
          <>
            <Field
              label="Satır genişliği (karakter)"
              hint="80mm yazıcıda 48, 58mm yazıcıda 32."
            >
              <Select
                value={draft.charactersPerLine}
                onChange={(event) => patch({ charactersPerLine: Number(event.target.value) })}
              >
                <option value={48}>48 (80mm)</option>
                <option value={32}>32 (58mm)</option>
              </Select>
            </Field>

            <div className="space-y-1 border-t border-(--color-border) pt-4">
              <Toggle
                label="Adisyona ürün eklenince ocak fişini otomatik bas"
                hint="Kapalıysa ocak fişi elle basılır."
                checked={draft.autoPrintKitchenTicket}
                onChange={(checked) => patch({ autoPrintKitchenTicket: checked })}
              />
              <Toggle
                label="Hesap kapanınca kasa çekmecesini aç"
                hint="Yazıcının kasa çıkışına bağlı çekmece varsa çalışır."
                checked={draft.openCashDrawerOnClose}
                onChange={(checked) => patch({ openCashDrawerOnClose: checked })}
              />
            </div>
          </>
        )}
      </div>

      {status.kind !== 'idle' && (
        <p
          role="status"
          className={[
            'mt-4 rounded-(--radius-control) px-3 py-2.5 text-sm',
            status.kind === 'error'
              ? 'bg-(--color-status-alert-soft) text-(--color-status-alert)'
              : status.kind === 'ok'
                ? 'bg-(--color-status-ready-soft) text-(--color-status-ready)'
                : 'bg-(--color-surface-sunken) text-(--color-text-muted)',
          ].join(' ')}
        >
          {status.message}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        <Button onClick={save} disabled={status.kind === 'busy'}>
          Kaydet
        </Button>

        {isNetwork && (
          <Button
            variant="secondary"
            onClick={checkConnection}
            disabled={status.kind === 'busy' || !draft.host}
          >
            Bağlantıyı sına
          </Button>
        )}

        {draft.connection !== 'disabled' && (
          <Button
            variant="secondary"
            onClick={printTest}
            disabled={status.kind === 'busy'}
          >
            Test fişi bas
          </Button>
        )}
      </div>

      <div className="mt-8 rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-sunken) p-4 text-sm text-(--color-text-muted)">
        <p className="font-medium text-(--color-text)">Test fişinde ne kontrol edilmeli?</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Türkçe karakterler: <span className="font-medium">ç ğ ı i ö ş ü</span> ve{' '}
            <span className="font-medium">Ç Ğ I İ Ö Ş Ü</span> bozuk çıkmamalı.
          </li>
          <li>Fişin sonu otomatik kesilmeli.</li>
          <li>Kasa çekmecesi ayarı açıksa çekmece açılmalı.</li>
          <li>Sağdaki tutarlar sağ kenara hizalı olmalı.</li>
        </ul>
        <p className="mt-3">
          Karakterler bozuk çıkıyorsa yazıcı farklı bir kod sayfası kullanıyor olabilir; bu
          durumda kod sayfası ayarı gerekir (varsayılan: PC857 Türkçe).
        </p>
      </div>
    </div>
  );
}
