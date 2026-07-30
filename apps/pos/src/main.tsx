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
      staleTime: 10_000,
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
