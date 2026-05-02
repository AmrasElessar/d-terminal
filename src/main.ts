import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createI18n } from 'vue-i18n';

import App from './App.vue';
import tr from './locales/tr.json';
import en from './locales/en.json';

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
