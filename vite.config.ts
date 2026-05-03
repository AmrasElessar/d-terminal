/// <reference types="vitest" />
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

// vue-i18n için runtime compiler kullanıyoruz (CSP 'unsafe-eval' ile birlikte).
// @intlify/unplugin-vue-i18n ile build-time AST compile denedik (b7e74a7),
// vue-i18n 9 + Composition API + nested key mode'da composer "Unexpected
// return type" hatası verdi. v1.0.5'te vue-i18n 11'e migration ile tam
// çözüm gelecek. Şimdilik dev build için runtime compile.
export default defineConfig({
  plugins: [vue()],
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
    passWithNoTests: true,
  },
});
