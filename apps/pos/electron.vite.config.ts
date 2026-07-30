import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

/**
 * @adisyon/shared bir workspace paketi ve KAYNAK TypeScript olarak geliyor;
 * externalize edilirse Node onu require edemez. Bu yuzden derlemeye dahil
 * ediyoruz. sharp ve node-thermal-printer ise disarida kalmali - native /
 * CommonJS modulleri paketlemek sorun cikarir.
 */
const externalize = () => externalizeDepsPlugin({ exclude: ['@adisyon/shared'] });

export default defineConfig({
  main: {
    build: {
      outDir: 'dist-electron/main',
      lib: { entry: resolve(__dirname, 'electron/main.ts') },
    },
    plugins: [externalize()],
  },

  preload: {
    build: {
      outDir: 'dist-electron/preload',
      lib: { entry: resolve(__dirname, 'electron/preload.ts') },
    },
    plugins: [externalize()],
  },

  renderer: {
    root: __dirname,
    build: {
      outDir: 'dist-electron/renderer',
      rollupOptions: { input: resolve(__dirname, 'index.html') },
    },
    resolve: {
      alias: { '@': resolve(__dirname, 'src') },
    },
    plugins: [react(), tailwindcss()],
  },
});
