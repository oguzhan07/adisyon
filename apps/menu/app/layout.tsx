import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Menü',
  description: 'Güncel menü ve fiyatlar',
  // QR ile acilan bir sayfa: arama motoru indekslemesine gerek yok
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Menude yazi buyutmek isteyen musteriyi engellemeyelim
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
