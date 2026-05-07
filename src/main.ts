import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createI18n } from 'vue-i18n';

import './fonts'; // Bundled @fontsource fontları (8 popüler dev mono)
import App from './App.vue';
import { messages, availableLocales, pickInitialLocale } from '@/locales';
import { installGlobalErrorHandlers, createLogger } from '@/utils/logger';

installGlobalErrorHandlers();
const log = createLogger('main');
log.info('frontend bootstrap');

export const i18n = createI18n({
  legacy: false,
  locale: pickInitialLocale(),
  // Eksik çeviri anahtarları Türkçeye düşer — D-Terminal'in birincil dili
  // Türkçe; çevrilmemiş bir stub dilinde key bulunamayınca İngilizce yerine
  // Türkçe görünür.
  fallbackLocale: 'tr',
  messages,
  warnHtmlMessage: false,
  // Stub locale'ler için: eksik anahtar uyarılarını sustur (fallback yine
  // İngilizceye düşer). Çevirmen çalışırken konsolu doldurmasın.
  missingWarn: false,
  fallbackWarn: false,
});

log.info('locales loaded', { count: availableLocales.length });

const app = createApp(App);
app.use(createPinia());
app.use(i18n);
app.mount('#app');
