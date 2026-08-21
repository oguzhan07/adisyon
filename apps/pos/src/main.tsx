import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { FeedbackProvider } from './ui/feedback';
import './index.css';

/**
 * Kasa programi "sadece online" calisir (plan karari). Bu yuzden yeniden
 * deneme davranisini bilincli ayarliyoruz: gecici ag hicciklarinda sessizce
 * tekrar dene, ama sonsuz donguye girme - kasiyerin "bir sey olmuyor"
 * hissine kapilmasi en kotu senaryo.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
      refetchOnWindowFocus: false,
      // Menu/masa gibi veriler nadiren degisir; 5 dakika taze sayilir ve ekran
      // gecislerinde veritabani BEKLENMEZ. Degisiklik yapan islemler zaten
      // ilgili sorguyu gecersiz kilarak aninda tazeliyor.
      staleTime: 5 * 60 * 1000,
      // Onbellekteki veri hemen gosterilip tazeleme arka planda yapilsin
      refetchOnMount: false,
    },
    mutations: {
      // Yazma islemleri otomatik tekrarlanmaz: ayni odemenin iki kez
      // kaydedilmesi riski, tek denemenin basarisiz olmasindan agirdir
      retry: 0,
    },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('#root bulunamadı');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <FeedbackProvider>
        <App />
      </FeedbackProvider>
    </QueryClientProvider>
  </StrictMode>,
);
