// Locale yükleyici. `src/locales/*.json` build-time bundle'a alınır; yeni bir
// dil eklemek için yapılacak tek şey dosya bırakmak — kod değişmez.
//
// Optimization: `raw` glob daha önce eager idi (her dilin ham JSON metni
// startup'ta yükleniyordu, _meta okumak için). 33 dil × ~3-5 KB = ~100-150 KB
// gereksiz initial bundle. Şimdi raw lazy — `loadLocaleMeta()` çağrılınca
// (Settings dil seçici açılınca) on-demand yüklenir.

export interface LocaleMeta {
  language: string;
  nativeName: string;
  code: string;
  translator: string;
  completion: string;
}

// `Record<string, any>` zorunlu: vue-i18n'in `LocaleMessage<VueMessageType>`
// tipi derinlemesine recursive (string | VNode | array | nested dict) union;
// `unknown` ile sıkılaştırmak createI18n imzasıyla çakışıyor. `LocaleMessages
// <VueMessageType>` import etmek de aynı nedenle başarısız — vue-i18n
// exporting tipler ile generic instantiation tam uyuşmuyor. Eksik-key
// güvenliği `locales/parity.test.ts` ile sağlanıyor (runtime parity check).
// NOT: `@typescript-eslint/no-explicit-any` projemizde register değil —
// eslint-disable yorumu eklemeye gerek yok (gereksiz yorum CI'da hata olur).
const compiled = import.meta.glob<Record<string, any>>('./*.json', {
  eager: true,
  import: 'default',
});
// LAZY: raw JSON yalnızca _meta için gerekli; eager yapma.
const rawLoaders = import.meta.glob<string>('./*.json', {
  query: '?raw',
  import: 'default',
});

export const messages: Record<string, any> = {};
export const availableLocales: string[] = [];
export const localeMeta: Record<string, LocaleMeta> = {};

for (const [path, mod] of Object.entries(compiled)) {
  const code = path.match(/^\.\/(.+)\.json$/)?.[1];
  if (!code) continue;
  const { _meta: _ignored, ...entries } = mod as Record<string, any>;
  void _ignored;
  messages[code] = entries;
  availableLocales.push(code);
  // Önce default fallback meta. loadLocaleMeta() çağrılırsa override edilir.
  localeMeta[code] = {
    language: code,
    nativeName: code,
    code,
    translator: '',
    completion: '?',
  };
}

availableLocales.sort();

let metaLoaded = false;
/** Raw JSON globlarını lazy fetch et + `_meta` alanlarını localeMeta'ya
 *  dağıt. Settings dil seçici/açılır ilk render'ında çağrılır; idempotent. */
export async function loadLocaleMeta(): Promise<void> {
  if (metaLoaded) return;
  const entries = await Promise.all(
    Object.entries(rawLoaders).map(async ([path, loader]) => {
      const code = path.match(/^\.\/(.+)\.json$/)?.[1];
      if (!code) return null;
      try {
        const text = await loader();
        const parsed = JSON.parse(text) as { _meta?: LocaleMeta };
        if (parsed._meta && typeof parsed._meta === 'object') {
          return [code, parsed._meta] as const;
        }
      } catch {
        /* yoksay */
      }
      return null;
    }),
  );
  for (const item of entries) {
    if (item) localeMeta[item[0]] = item[1];
  }
  metaLoaded = true;
}

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
