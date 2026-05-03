import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createI18n } from 'vue-i18n';

import './fonts'; // Bundled @fontsource fontları (8 popüler dev mono)
import App from './App.vue';
import tr from './locales/tr.json';
import en from './locales/en.json';
import { installGlobalErrorHandlers, createLogger } from '@/utils/logger';

installGlobalErrorHandlers();
createLogger('main').info('frontend bootstrap');

const i18n = createI18n({
  legacy: false,
  locale: navigator.language.startsWith('tr') ? 'tr' : 'en',
  fallbackLocale: 'en',
  messages: { tr, en },
  warnHtmlMessage: false,
});

const app = createApp(App);
app.use(createPinia());
app.use(i18n);
app.mount('#app');
