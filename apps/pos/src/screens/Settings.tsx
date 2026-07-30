import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useAreas, useTables } from '../lib/orderData';
import { useVenueMutations } from '../lib/venueData';
import { useSettings, useUpdateSettings, type SettingsRow } from '../lib/settings';
import { describeError } from '../lib/supabase';
import { Button } from '../ui/Button';
import { Field, NumberInput, Select, TextInput } from '../ui/Field';
import { useFeedback } from '../ui/feedback';
import { PrinterSettingsScreen } from './PrinterSettings';

type Tab = 'shop' | 'venue' | 'printer' | 'qr';

const TABS: { id: Tab; label: string }[] = [
  { id: 'shop', label: 'Dükkan' },
  { id: 'venue', label: 'Bölge / Masa' },
  { id: 'printer', label: 'Yazıcı' },
  { id: 'qr', label: 'QR Kod' },
];

export function Settings() {
  const [tab, setTab] = useState<Tab>('shop');

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">Ayarlar</h1>

      <div className="mb-6 flex gap-2 border-b border-(--color-border)">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={[
              'min-h-12 px-4 font-medium',
              tab === t.id
                ? 'border-b-2 border-(--color-accent) text-(--color-accent)'
                : 'text-(--color-text-muted)',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'shop' && <ShopSettings />}
      {tab === 'venue' && <VenueSettings />}
      {tab === 'printer' && <PrinterSettingsScreen />}
      {tab === 'qr' && <QrSettings />}
    </div>
  );
}

/* ------------------------------------------------------------------ dukkan */

function ShopSettings() {
  const feedback = useFeedback();
  const { data: settings, isLoading } = useSettings();
  const update = useUpdateSettings();
  const [draft, setDraft] = useState<Partial<SettingsRow>>({});

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  if (isLoading) return <p className="text-(--color-text-muted)">Yükleniyor…</p>;

  async function save() {
    try {
      await update.mutateAsync({
        shop_name: draft.shop_name,
        address: draft.address,
        phone: draft.phone,
        receipt_header: draft.receipt_header,
        receipt_footer: draft.receipt_footer,
        vat_percent: draft.vat_percent,
        business_day_start_hour: draft.business_day_start_hour,
        stock_variance_threshold_percent: draft.stock_variance_threshold_percent,
      });
      feedback.toast('Ayarlar kaydedildi.', 'ok');
    } catch (e) {
      feedback.toast(describeError(e), 'error');
    }
  }

  const set = (patch: Partial<SettingsRow>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <div className="max-w-xl space-y-4">
      <Field label="Dükkan adı">
        <TextInput value={draft.shop_name ?? ''} onChange={(e) => set({ shop_name: e.target.value })} />
      </Field>
      <Field label="Adres">
        <TextInput value={draft.address ?? ''} onChange={(e) => set({ address: e.target.value || null })} />
      </Field>
      <Field label="Telefon">
        <TextInput value={draft.phone ?? ''} onChange={(e) => set({ phone: e.target.value || null })} />
      </Field>
      <Field label="Fiş başlığı" hint="Fişin en üstünde büyük yazar. Boşsa dükkan adı kullanılır.">
        <TextInput
          value={draft.receipt_header ?? ''}
          onChange={(e) => set({ receipt_header: e.target.value || null })}
        />
      </Field>
      <Field label="Fiş alt notu">
        <TextInput
          value={draft.receipt_footer ?? ''}
          onChange={(e) => set({ receipt_footer: e.target.value || null })}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="KDV oranı (%)" hint="Fiyatlar KDV dahil girilir.">
          <NumberInput
            value={draft.vat_percent ?? ''}
            onChange={(e) => set({ vat_percent: Number(e.target.value.replace(',', '.')) || 0 })}
          />
        </Field>
        <Field
          label="İş günü başlangıç saati"
          hint="Gece kapanışları için. 4 = sabah 04:00'ten önceki satış önceki güne yazılır."
        >
          <Select
            value={draft.business_day_start_hour ?? 4}
            onChange={(e) => set({ business_day_start_hour: Number(e.target.value) })}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label="Stok fark eşiği (%)"
        hint="Stok raporunda bu yüzdeyi aşan fark kırmızı işaretlenir."
      >
        <NumberInput
          value={draft.stock_variance_threshold_percent ?? ''}
          onChange={(e) =>
            set({ stock_variance_threshold_percent: Number(e.target.value.replace(',', '.')) || 0 })
          }
        />
      </Field>

      <Button onClick={save}>Kaydet</Button>
    </div>
  );
}

/* --------------------------------------------------------------- bolge/masa */

function VenueSettings() {
  const feedback = useFeedback();
  const areas = useAreas();
  const tables = useTables();
  const { saveArea, saveTable, removeTable } = useVenueMutations();

  const [newArea, setNewArea] = useState('');
  const [newTable, setNewTable] = useState<Record<string, string>>({});

  async function addArea() {
    if (newArea.trim() === '') return;
    try {
      await saveArea.mutateAsync({ name: newArea.trim(), sort_order: (areas.data ?? []).length });
      setNewArea('');
    } catch (e) {
      feedback.toast(describeError(e), 'error');
    }
  }

  async function addTable(areaId: string) {
    const name = (newTable[areaId] ?? '').trim();
    if (name === '') return;
    const count = (tables.data ?? []).filter((t) => t.area_id === areaId).length;
    try {
      await saveTable.mutateAsync({ area_id: areaId, name, sort_order: count });
      setNewTable((s) => ({ ...s, [areaId]: '' }));
    } catch (e) {
      feedback.toast(describeError(e), 'error');
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-5 flex gap-2">
        <TextInput
          value={newArea}
          onChange={(e) => setNewArea(e.target.value)}
          placeholder="Yeni bölge adı (örn. Bahçe)"
        />
        <Button onClick={addArea}>Bölge ekle</Button>
      </div>

      {(areas.data ?? []).map((area) => {
        const areaTables = (tables.data ?? []).filter((t) => t.area_id === area.id);
        return (
          <section key={area.id} className="mb-6 rounded-(--radius-card) border border-(--color-border) p-4">
            <h2 className="mb-3 font-semibold">{area.name}</h2>

            <div className="mb-3 flex flex-wrap gap-2">
              {areaTables.map((table) => (
                <span
                  key={table.id}
                  className="flex items-center gap-2 rounded-(--radius-control) border border-(--color-border) px-3 py-1.5 text-sm"
                >
                  {table.name}
                  <button
                    type="button"
                    onClick={() => removeTable.mutate(table.id)}
                    className="text-(--color-status-alert)"
                    aria-label="Kaldır"
                  >
                    ✕
                  </button>
                </span>
              ))}
              {areaTables.length === 0 && (
                <span className="text-sm text-(--color-text-faint)">Masa yok.</span>
              )}
            </div>

            <div className="flex gap-2">
              <TextInput
                value={newTable[area.id] ?? ''}
                onChange={(e) => setNewTable((s) => ({ ...s, [area.id]: e.target.value }))}
                placeholder="Masa adı/no"
                className="max-w-xs"
              />
              <Button variant="secondary" onClick={() => addTable(area.id)}>
                Masa ekle
              </Button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------- QR kod */

function QrSettings() {
  const feedback = useFeedback();
  const settings = useSettings();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const menuUrl = (import.meta.env.VITE_MENU_URL as string | undefined) ?? '';

  useEffect(() => {
    if (!menuUrl) return;
    QRCode.toDataURL(menuUrl, { width: 320, margin: 2 })
      .then(setDataUrl)
      .catch(() => setDataUrl(null));
  }, [menuUrl]);

  async function printLabel() {
    if (!settings.data || !dataUrl) return;
    const result = await window.desktop.print.qrLabel(settings.data.printer, {
      shopName: settings.data.shop_name,
      url: menuUrl,
      pngDataUrl: dataUrl,
    });
    feedback.toast(
      result.ok ? 'QR etiketi basıldı.' : (result.error ?? 'Basılamadı.'),
      result.ok ? 'ok' : 'error',
    );
  }

  if (!menuUrl) {
    return (
      <p className="text-(--color-text-muted)">
        QR kodu üretmek için önce <code className="font-mono">.env</code> dosyasında{' '}
        <code className="font-mono">VITE_MENU_URL</code> tanımlanmalı (menü sitesinin adresi).
      </p>
    );
  }

  return (
    <div className="max-w-md">
      <p className="mb-4 text-sm text-(--color-text-muted)">
        Bu QR kodu masalara yapıştırın; müşteriler okutunca güncel menü açılır.
      </p>
      <div className="inline-block rounded-(--radius-card) border border-(--color-border) bg-white p-4">
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt="Menü QR kodu" width={280} height={280} />
        ) : (
          <p className="text-(--color-text-muted)">QR üretilemedi.</p>
        )}
      </div>
      <p className="mt-2 break-all text-xs text-(--color-text-faint)">{menuUrl}</p>
      <Button className="mt-4" variant="secondary" onClick={printLabel} disabled={!dataUrl}>
        Yazıcıdan bas
      </Button>
    </div>
  );
}
