import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,

  // Monorepo: workspace paketi kaynak TypeScript olarak geliyor, derlenmesi gerekiyor
  transpilePackages: ['@adisyon/shared'],

  // Kasa programindan gelen "Menüyü yayınla" istegi ayri bir kaynaktan gelir
  async headers() {
    return [
      {
        source: '/api/revalidate',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ];
  },
};

export default config;
