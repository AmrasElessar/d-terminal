/// <reference types="vitest" />
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite';
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';

// vue-i18n 11 + unplugin: locale JSON'ları build-time AST'ye derlenir.
// jitCompilation default false → runtime compiler kullanılmaz → CSP
// 'unsafe-eval' kaldırılabildi. v9 denemesindeki composer hatası v11'de
// düzeldi (compile output composer shape'iyle uyumlu).
export default defineConfig({
  plugins: [
    vue(),
    VueI18nPlugin({
      // Sadece JSON locale dosyalarını AST'ye derle. `src/locales/index.ts`
      // bir loader (import.meta.glob) — onu locale message gibi davranmasın.
      include: [resolve(__dirname, './src/locales/**/*.json')],
      runtimeOnly: true,
      // Strict-mode: compile fail olursa fallback runtime compile değil, hata
      jitCompilation: false,
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Tauri bekledikleri:
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '0.0.0.0',
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 1421,
    },
    watch: {
      ignored: ['**/src-tauri/**', '**/sidecar/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      output: {
        manualChunks: {
          xterm: ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links'],
          vue: ['vue', 'pinia', 'vue-i18n'],
        },
      },
    },
  },
  test: {
    // Sidecar testleri node:test API'siyle yazılmış; vitest sadece src/ altında çalışır
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'src-tauri', 'sidecar', 'dist-ssr', '.idea', '.git', '.cache'],
    environment: 'jsdom',
    // CI'da test bulunamazsa fail — daha önce true idi, sıfır frontend testi
    // ile CI yeşil tik veriyordu (yanılsama). En az bir test mevcut artık
    // (utils/redact.test.ts), bu yüzden gate açılıyor.
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,vue}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/**/*.d.ts',
        'src/locales/**',
        'src/main.ts',
        'src/env.d.ts',
      ],
      // Mevcut frontend coverage'ı düşük (~10%); bu eşik gerçekçi taban
      // çizgisi. 1.0 yolunda store/composable test'leri eklendikçe yükseltilir.
      thresholds: {
        lines: 10,
        functions: 10,
        branches: 50,
        statements: 10,
      },
    },
  },
});
