// Locale yükleyici. `src/locales/*.json` build-time bundle'a alınır; yeni bir
// dil eklemek için yapılacak tek şey dosya bırakmak — kod değişmez.

export interface LocaleMeta {
  language: string;
  nativeName: string;
  code: string;
  translator: string;
  completion: string;
}

// İki kanal:
//   1) `compiled` — unplugin-vue-i18n tarafından AST'ye derlenmiş messages.
//      vue-i18n runtime bunu kullanır.
//   2) `raw` — Vite `?raw` query ile ham JSON metni. _meta gibi insan-okuyacağı
//      alanları AST düğümü değil string olarak okumak için.
// vue-i18n LocaleMessage tipi recursive — burada `any` bilinçli bir kaçış.
const compiled = import.meta.glob<Record<string, any>>('./*.json', {
  eager: true,
  import: 'default',
});
const raw = import.meta.glob<string>('./*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});

export const messages: Record<string, any> = {};
export const availableLocales: string[] = [];
export const localeMeta: Record<string, LocaleMeta> = {};

for (const [path, mod] of Object.entries(compiled)) {
  const code = path.match(/^\.\/(.+)\.json$/)?.[1];
  if (!code) continue;

  // messages: derlenmiş AST'den `_meta` anahtarını çıkar (i18n için anlamsız).
  const { _meta: _ignored, ...entries } = mod as Record<string, any>;
  void _ignored;
  messages[code] = entries;
  availableLocales.push(code);

  // localeMeta: ham JSON'dan oku (UI'de native isim olarak gösterilir).
  let meta: LocaleMeta | undefined;
  const rawText = raw[path];
  if (rawText) {
    try {
      const parsed = JSON.parse(rawText) as { _meta?: LocaleMeta };
      if (parsed._meta && typeof parsed._meta === 'object') {
        meta = parsed._meta;
      }
    } catch {
      /* parse hatasında fallback'e düş */
    }
  }
  localeMeta[code] = meta ?? {
    language: code,
    nativeName: code,
    code,
    translator: '',
    completion: '?',
  };
}

availableLocales.sort();

/** Tarayıcı diline en iyi eşleşeni döner; yoksa `en`, o da yoksa ilk kayıt. */
export function pickInitialLocale(navLang: string = navigator.language || 'en'): string {
  if (availableLocales.includes(navLang)) return navLang;
  const base = navLang.split('-')[0] ?? navLang;
  if (availableLocales.includes(base)) return base;
  const startsWith = availableLocales.find((l) => l.startsWith(base));
  if (startsWith) return startsWith;
  if (availableLocales.includes('en')) return 'en';
  return availableLocales[0] ?? 'en';
}
