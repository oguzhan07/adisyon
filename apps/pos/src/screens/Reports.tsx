import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  businessDayRange,
  formatBusinessDay,
  formatKurus,
  formatQuantity,
  formatTRY,
  recentBusinessDays,
  type BaseUnit,
} from '@adisyon/shared';
import {
  useDailySummary,
  useHourlyLoad,
  useProductCosts,
  useProductSales,
} from '../lib/reportData';
import { useStockReport } from '../lib/stockData';
import { useSettings } from '../lib/settings';
import { buildZReport } from '../lib/zreportHelper';
import { describeError } from '../lib/supabase';
import { Button } from '../ui/Button';
import { Select } from '../ui/Field';
import { useFeedback } from '../ui/feedback';

type Tab = 'daily' | 'products' | 'hourly' | 'stock' | 'profit';

const TABS: { id: Tab; label: string }[] = [
  { id: 'daily', label: 'Gün Sonu' },
  { id: 'products', label: 'En Çok Satan' },
  { id: 'hourly', label: 'Saatlik Yoğunluk' },
  { id: 'stock', label: 'Stok Raporu' },
  { id: 'profit', label: 'Ürün Kârlılık' },
];

export function Reports() {
  const [tab, setTab] = useState<Tab>('daily');
  const settings = useSettings();
  const startHour = settings.data?.business_day_start_hour ?? 4;

  // Son 14 is gunu; varsayilan bugun
  const days = useMemo(() => recentBusinessDays(startHour, 14), [startHour]);
  const [day, setDay] = useState(days[0] ?? '');

  // Aktif gun degisince listeyle uyumlu tut
  const selectedDay = days.includes(day) ? day : (days[0] ?? '');

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Raporlar</h1>
        <Select
          value={selectedDay}
          onChange={(e) => setDay(e.target.value)}
          className="w-56"
        >
          {days.map((d) => (
            <option key={d} value={d}>
              {formatBusinessDay(d)}
            </option>
          ))}
        </Select>
      </div>

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

      {tab === 'daily' && <DailyReport day={selectedDay} startHour={startHour} />}
      {tab === 'products' && <ProductsReport day={selectedDay} />}
      {tab === 'hourly' && <HourlyReport day={selectedDay} />}
      {tab === 'stock' && <StockReportTab day={selectedDay} startHour={startHour} />}
      {tab === 'profit' && <ProfitReport />}
    </div>
  );
}

/* ------------------------------------------------------------- gun sonu */

function DailyReport({ day, startHour }: { day: string; startHour: number }) {
  const feedback = useFeedback();
  const summary = useDailySummary(day, day);
  const productSales = useProductSales(day, day);
  const settings = useSettings();

  if (summary.isLoading) return <p className="text-(--color-text-muted)">Yükleniyor…</p>;
  if (summary.error) return <p className="text-(--color-status-alert)">{describeError(summary.error)}</p>;

  const row = summary.data?.[0];

  if (!row) {
    return <p className="text-(--color-text-muted)">Bu gün için satış kaydı yok.</p>;
  }

  async function printZ() {
    if (!settings.data || !row) return;
    const top = (productSales.data ?? []).slice(0, 8).map((p) => ({
      name: p.product_name,
      quantity: p.quantity_sold,
      revenueKurus: p.revenue_kurus,
    }));
    const data = buildZReport(row, settings.data, top, startHour);
    const result = await window.desktop.print.zreport(settings.data.printer, data);
    feedback.toast(
      result.ok ? 'Gün sonu fişi basıldı.' : (result.error ?? 'Basılamadı.'),
      result.ok ? 'ok' : 'error',
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Ciro" value={formatTRY(row.net_kurus)} big />
        <Stat label="Adisyon" value={String(row.order_count)} />
        <Stat label="Ortalama sepet" value={formatTRY(row.avg_basket_kurus)} />
        <Stat label="Nakit" value={formatTRY(row.cash_kurus)} tone="cash" />
        <Stat label="Kart" value={formatTRY(row.card_kurus)} tone="card" />
        <Stat label="KDV (dahil)" value={formatTRY(row.vat_kurus)} />
      </div>

      {(row.discount_kurus > 0 || row.cancelled_item_count > 0) && (
        <div className="mt-4 rounded-(--radius-card) border border-(--color-border) p-4 text-sm">
          {row.discount_kurus > 0 && (
            <div className="flex justify-between">
              <span className="text-(--color-text-muted)">İndirim / ikram</span>
              <span className="tabular">{formatTRY(row.discount_kurus)}</span>
            </div>
          )}
          {row.cancelled_item_count > 0 && (
            <div className="mt-1 flex justify-between">
              <span className="text-(--color-text-muted)">
                İptal edilen kalem ({row.cancelled_item_count})
              </span>
              <span className="tabular">{formatTRY(row.cancelled_item_kurus)}</span>
            </div>
          )}
        </div>
      )}

      <Button className="mt-5" variant="secondary" onClick={printZ}>
        Gün sonu fişi bas
      </Button>
    </div>
  );
}

function Stat({
  label,
  value,
  big,
  tone,
}: {
  label: string;
  value: string;
  big?: boolean;
  tone?: 'cash' | 'card';
}) {
  return (
    <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-4">
      <div className="text-sm text-(--color-text-muted)">{label}</div>
      <div
        className={[
          'tabular mt-1 font-bold',
          big ? 'text-2xl' : 'text-xl',
          tone === 'cash' ? 'text-(--color-cash)' : tone === 'card' ? 'text-(--color-card)' : '',
        ].join(' ')}
      >
        {value}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- en cok satan */

function ProductsReport({ day }: { day: string }) {
  const sales = useProductSales(day, day);
  if (sales.isLoading) return <p className="text-(--color-text-muted)">Yükleniyor…</p>;
  const rows = sales.data ?? [];
  if (rows.length === 0) return <p className="text-(--color-text-muted)">Satış kaydı yok.</p>;

  return (
    <div className="overflow-hidden rounded-(--radius-card) border border-(--color-border)">
      <table className="w-full text-sm">
        <thead className="bg-(--color-surface-sunken) text-left text-(--color-text-muted)">
          <tr>
            <th className="px-4 py-2 font-medium">Ürün</th>
            <th className="px-4 py-2 text-right font-medium">Adet</th>
            <th className="px-4 py-2 text-right font-medium">Ciro</th>
            <th className="px-4 py-2 text-right font-medium">Brüt kâr</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.product_id} className="border-t border-(--color-border)">
              <td className="px-4 py-2.5">{r.product_name}</td>
              <td className="tabular px-4 py-2.5 text-right">{r.quantity_sold}</td>
              <td className="tabular px-4 py-2.5 text-right">{formatTRY(r.revenue_kurus)}</td>
              <td className="tabular px-4 py-2.5 text-right text-(--color-text-muted)">
                {formatTRY(r.gross_profit_kurus)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------- saatlik yogunluk */

function HourlyReport({ day }: { day: string }) {
  const load = useHourlyLoad(day, day);
  if (load.isLoading) return <p className="text-(--color-text-muted)">Yükleniyor…</p>;

  const data = (load.data ?? [])
    .filter((r) => r.order_count > 0 || r.revenue_kurus > 0)
    .map((r) => ({
      saat: `${String(r.hour_of_day).padStart(2, '0')}:00`,
      ciro: r.revenue_kurus / 100,
      adisyon: r.order_count,
    }));

  if (data.length === 0) return <p className="text-(--color-text-muted)">Satış kaydı yok.</p>;

  return (
    <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-4">
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis dataKey="saat" stroke="var(--color-text-muted)" fontSize={12} />
            <YAxis stroke="var(--color-text-muted)" fontSize={12} />
            <Tooltip
              formatter={(value) => [`${Number(value).toLocaleString('tr-TR')} ₺`, 'Ciro']}
              contentStyle={{
                background: 'var(--color-surface-raised)',
                border: '1px solid var(--color-border)',
                borderRadius: 8,
              }}
            />
            <Bar dataKey="ciro" fill="var(--color-accent)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- stok raporu */

function StockReportTab({ day, startHour }: { day: string; startHour: number }) {
  const range = useMemo(() => businessDayRange(day, startHour), [day, startHour]);
  const report = useStockReport(range.fromIso, range.toIso, !!day);
  const settings = useSettings();
  const threshold = settings.data?.stock_variance_threshold_percent ?? 5;

  if (report.isLoading) return <p className="text-(--color-text-muted)">Yükleniyor…</p>;
  if (report.error) return <p className="text-(--color-status-alert)">{describeError(report.error)}</p>;

  const rows = report.data ?? [];

  return (
    <div>
      <p className="mb-3 text-sm text-(--color-text-muted)">
        Seçili iş günü için malzeme hareketleri. <strong>Fark</strong> = fiili sayım − teorik kalan.
        Negatif fark beklenenden fazla harcandığını gösterir (fire, porsiyon şaşması ya da kayıp).
      </p>
      <div className="scroll-thin overflow-x-auto rounded-(--radius-card) border border-(--color-border)">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-(--color-surface-sunken) text-left text-(--color-text-muted)">
            <tr>
              <th className="px-3 py-2 font-medium">Malzeme</th>
              <th className="px-3 py-2 text-right font-medium">Devir</th>
              <th className="px-3 py-2 text-right font-medium">Giren</th>
              <th className="px-3 py-2 text-right font-medium">Satış</th>
              <th className="px-3 py-2 text-right font-medium">Zayi</th>
              <th className="px-3 py-2 text-right font-medium">Teorik</th>
              <th className="px-3 py-2 text-right font-medium">Sayılan</th>
              <th className="px-3 py-2 text-right font-medium">Fark</th>
              <th className="px-3 py-2 text-right font-medium">₺ etki</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const unit = r.base_unit as BaseUnit;
              const flagged =
                r.variance_percent !== null && Math.abs(r.variance_percent) >= threshold;
              return (
                <tr
                  key={r.ingredient_id}
                  className={[
                    'border-t border-(--color-border)',
                    flagged ? 'bg-(--color-status-alert-soft)' : '',
                  ].join(' ')}
                >
                  <td className="px-3 py-2">{r.ingredient_name}</td>
                  <td className="tabular px-3 py-2 text-right">{formatQuantity(r.opening_qty, unit)}</td>
                  <td className="tabular px-3 py-2 text-right">{formatQuantity(r.purchased_qty, unit)}</td>
                  <td className="tabular px-3 py-2 text-right">{formatQuantity(r.sold_qty, unit)}</td>
                  <td className="tabular px-3 py-2 text-right">{formatQuantity(r.waste_qty, unit)}</td>
                  <td className="tabular px-3 py-2 text-right font-medium">
                    {formatQuantity(r.theoretical_qty, unit)}
                  </td>
                  <td className="tabular px-3 py-2 text-right">
                    {r.counted_qty === null ? '—' : formatQuantity(r.counted_qty, unit)}
                  </td>
                  <td
                    className={[
                      'tabular px-3 py-2 text-right font-medium',
                      r.variance_qty === null
                        ? 'text-(--color-text-faint)'
                        : r.variance_qty < 0
                          ? 'text-(--color-status-alert)'
                          : 'text-(--color-status-ready)',
                    ].join(' ')}
                  >
                    {r.variance_qty === null ? '—' : formatQuantity(r.variance_qty, unit)}
                  </td>
                  <td className="tabular px-3 py-2 text-right text-(--color-text-muted)">
                    {r.variance_cost_kurus === null ? '—' : `${formatKurus(r.variance_cost_kurus)} ₺`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- urun karlilik */

function ProfitReport() {
  const costs = useProductCosts();
  if (costs.isLoading) return <p className="text-(--color-text-muted)">Yükleniyor…</p>;
  const rows = costs.data ?? [];

  return (
    <div className="overflow-hidden rounded-(--radius-card) border border-(--color-border)">
      <table className="w-full text-sm">
        <thead className="bg-(--color-surface-sunken) text-left text-(--color-text-muted)">
          <tr>
            <th className="px-4 py-2 font-medium">Ürün</th>
            <th className="px-4 py-2 text-right font-medium">Satış fiyatı</th>
            <th className="px-4 py-2 text-right font-medium">Maliyet</th>
            <th className="px-4 py-2 text-right font-medium">Brüt kâr</th>
            <th className="px-4 py-2 text-right font-medium">Marj</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.product_id} className="border-t border-(--color-border)">
              <td className="px-4 py-2.5">
                {r.name}
                {!r.has_recipe && (
                  <span className="ml-2 text-xs text-(--color-text-faint)">reçetesiz</span>
                )}
              </td>
              <td className="tabular px-4 py-2.5 text-right">{formatTRY(r.price_kurus)}</td>
              <td className="tabular px-4 py-2.5 text-right text-(--color-text-muted)">
                {r.has_recipe ? formatTRY(r.cost_kurus) : '—'}
              </td>
              <td className="tabular px-4 py-2.5 text-right">
                {r.has_recipe ? formatTRY(r.gross_profit_kurus) : '—'}
              </td>
              <td className="tabular px-4 py-2.5 text-right font-medium">
                {r.margin_percent === null ? '—' : `%${r.margin_percent.toFixed(0)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
