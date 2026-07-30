import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
// v8'den itibaren dom baglantilari ayri paket degil, 'react-router' icinde
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router';
import { configError, supabase } from './lib/supabase';
import { Login } from './screens/Login';
import { Tables } from './screens/Tables';
import { Order } from './screens/Order';
import { Checkout } from './screens/Checkout';
import { Stock } from './screens/Stock';
import { MenuAdmin } from './screens/MenuAdmin';
import { Reports } from './screens/Reports';
import { Settings } from './screens/Settings';

/**
 * Uygulama kabugu.
 *
 * HashRouter kullaniyoruz: paketlenmis Electron uygulamasi dosyayi file://
 * uzerinden yukler ve BrowserRouter'in gerektirdigi sunucu tarafi yol
 * cozumlemesi orada calismaz.
 */
export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (configError) {
      setChecking(false);
      return;
    }

    // Kayitli oturum safeStorage'dan cozulur (bkz. lib/supabase.ts)
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChecking(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setChecking(false);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  if (configError) return <ConfigErrorScreen message={configError} />;

  if (checking) {
    return (
      <div className="flex h-full items-center justify-center text-(--color-text-muted)">
        Yükleniyor…
      </div>
    );
  }

  if (!session) return <Login />;

  return (
    <HashRouter>
      <div className="flex h-full">
        <Sidebar />
        <main className="scroll-thin flex-1 overflow-y-auto bg-(--color-surface)">
          <Routes>
            <Route path="/" element={<Navigate to="/masalar" replace />} />
            <Route path="/masalar" element={<Tables />} />
            <Route path="/adisyon/:orderId" element={<Order />} />
            <Route path="/kasa/:orderId" element={<Checkout />} />
            <Route path="/stok" element={<Stock />} />
            <Route path="/menu" element={<MenuAdmin />} />
            <Route path="/raporlar" element={<Reports />} />
            <Route path="/ayarlar" element={<Settings />} />
            <Route path="*" element={<Navigate to="/masalar" replace />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}

/** Sol sabit gezinme: nerede oldugun her an belli olsun */
// Kasa ayri bir menu ogesi degil: adisyon ekranindan "Hesap / Öde" ile acilir.
// Sipariş Takip (ocak durum takibi) bu isletmede kullanilmiyor, menuden cikarildi;
// ocak fisi basimi adisyon ekranindan calismaya devam ediyor.
const NAV_ITEMS = [
  { to: '/masalar', label: 'Masalar' },
  { to: '/stok', label: 'Stok' },
  { to: '/menu', label: 'Menü' },
  { to: '/raporlar', label: 'Raporlar' },
  { to: '/ayarlar', label: 'Ayarlar' },
];

function Sidebar() {
  return (
    <nav className="flex w-52 shrink-0 flex-col border-r border-(--color-border) bg-(--color-surface-raised) py-4">
      <div className="px-4 pb-4 text-lg font-bold">Adisyon</div>

      <div className="flex flex-1 flex-col gap-1 px-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              [
                'flex min-h-12 items-center rounded-(--radius-control) px-3 text-base transition-colors',
                isActive
                  ? 'bg-(--color-accent-soft) font-medium text-(--color-accent)'
                  : 'text-(--color-text-muted) hover:bg-(--color-surface-sunken)',
              ].join(' ')
            }
          >
            {item.label}
          </NavLink>
        ))}
      </div>

      <button
        type="button"
        onClick={() => void supabase.auth.signOut()}
        className="mx-2 flex min-h-12 items-center rounded-(--radius-control) px-3 text-sm text-(--color-text-faint) hover:bg-(--color-surface-sunken)"
      >
        Çıkış
      </button>
    </nav>
  );
}

/**
 * Yapilandirma eksikse ne yapilmasi gerektigini anlatan ekran.
 * Kurulum sirasinda boş beyaz pencere gormekten cok daha faydali.
 */
function ConfigErrorScreen({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-(--color-surface-sunken) p-6">
      <div className="max-w-lg rounded-(--radius-card) border border-(--color-border) bg-(--color-surface-raised) p-7">
        <h1 className="text-lg font-bold text-(--color-status-alert)">Yapılandırma eksik</h1>
        <p className="mt-2 text-(--color-text)">{message}</p>
        <p className="mt-4 text-sm text-(--color-text-muted)">
          Program klasöründeki <code className="font-mono">.env</code> dosyasını{' '}
          <code className="font-mono">.env.example</code> dosyasını örnek alarak oluşturun ve
          Supabase proje adresi ile anon anahtarını girin. Ardından programı yeniden başlatın.
        </p>
      </div>
    </div>
  );
}

