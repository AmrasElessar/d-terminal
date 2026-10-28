import { createApp } from 'vue';
import { createPinia } from 'pinia';

import './fonts'; // Bundled @fontsource fontları (8 popüler dev mono)
import App from './App.vue';
import { availableLocales } from '@/locales';
import { i18n } from '@/i18n';
import { installGlobalErrorHandlers, createLogger } from '@/utils/logger';

installGlobalErrorHandlers();
const log = createLogger('main');
log.info('frontend bootstrap');

export { i18n };

log.info('locales loaded', { count: availableLocales.length });

const app = createApp(App);
app.use(createPinia());
app.use(i18n);
app.mount('#app');
