// i18n örneği — main.ts'den ayrıldı: store/composable'lar `@/main` import
// edince uygulama bootstrap yan etkisi (createApp + mount) tetikleniyordu.

import { watch } from 'vue';
import { createI18n } from 'vue-i18n';
import { messages, pickInitialLocale } from '@/locales';

export const i18n = createI18n({
  legacy: false,
  locale: pickInitialLocale(),
  // Industry-standard fallback: eksik anahtarda İngilizce. Türkçe konuşmayan
  // bir kullanıcı (örn. Almanca/Fransızca stub) için 'tr'ye düşmek
  // anlaşılmaz; 'en' tüm dünyaya en yakın ortak dildir. Türkçe yine de
  // birincil dil olarak kalır (`pickInitialLocale` browser locale'inden
  // 'tr' seçerse hep gösterilir).
  fallbackLocale: 'en',
  messages,
  warnHtmlMessage: false,
  // Stub locale'ler için: eksik anahtar uyarılarını sustur (fallback yine
  // İngilizceye düşer). Çevirmen çalışırken konsolu doldurmasın.
  missingWarn: false,
  fallbackWarn: false,
});

/** RTL diller — `dir` attribute'u için. */
const RTL = new Set(['ar', 'fa', 'he', 'ur']);

/** `<html lang>` ve `dir` aktif dile senkron — ekran okuyucular telaffuzu ve
 *  tarayıcı yazım denetimini buna göre seçer (index.html statik `tr` idi). */
export function syncDocumentLang(locale: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.documentElement.dir = RTL.has(locale.split('-')[0] ?? '') ? 'rtl' : 'ltr';
}

watch(
  () => i18n.global.locale.value,
  (loc) => syncDocumentLang(loc),
  { immediate: true },
);

/** Komponent dışı (store, composable) çeviri yardımcısı. */
export function tGlobal(key: string, params?: Record<string, unknown>): string {
  return (i18n.global.t as (k: string, p?: Record<string, unknown>) => string)(key, params ?? {});
}
