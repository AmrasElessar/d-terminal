// Bundled developer mono fonts (self-hosted via @fontsource).
// 17 popüler programcı fontu — Regular (400) + Bold (700).
//
// Lazy-load mimarisi (v0.9.4+):
// Daha önce 17 font × 2 weight × 8-10 subset (latin/cyrillic/greek/...) tüm
// .css dosyaları eager import ediliyordu → 328 woff/woff2, ~4.1 MB başlangıç
// payload'ı (Frontend perf audit · K1). Kullanıcı tek font seçer, kalan 16
// font asla yüklenmez ama bundle'a dahildir.
//
// Yeni model:
//   - Yalnızca DEFAULT_FONT_FAMILY (JetBrains Mono) eager — kullanıcı ayarları
//     yüklenene kadar UI doğru fontla render olsun (FOUT azaltma).
//   - Diğer fontlar `ensureFontLoaded(family)` ile dinamik import edilir;
//     Settings'ten seçildiğinde @vite tarafında ayrı chunk'a düşer.
// Beklenen kazanç: ~3.5 MB initial bundle azalması, ilk açılış ~500ms hızlanır.

// Eager: yalnızca default font (kullanıcı settings yüklenene kadar geçici font)
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';

/** Family adı → loader. Vite glob yerine açık tanım — type-safe ve tree-shake
 *  garantili. Kullanıcı SettingsModal'da font seçince ilgili loader bir kez
 *  çağrılır; sonraki seçimde cache'lenmiş import-resolution devreye girer. */
const FONT_LOADERS: Record<string, () => Promise<unknown>> = {
  'JetBrains Mono':   () => Promise.resolve(),  // zaten eager
  'Fira Code':        () => Promise.all([import('@fontsource/fira-code/400.css'), import('@fontsource/fira-code/700.css')]),
  'Cascadia Code':    () => Promise.all([import('@fontsource/cascadia-code/400.css'), import('@fontsource/cascadia-code/700.css')]),
  'IBM Plex Mono':    () => Promise.all([import('@fontsource/ibm-plex-mono/400.css'), import('@fontsource/ibm-plex-mono/700.css')]),
  'Source Code Pro':  () => Promise.all([import('@fontsource/source-code-pro/400.css'), import('@fontsource/source-code-pro/700.css')]),
  'Inconsolata':      () => Promise.all([import('@fontsource/inconsolata/400.css'), import('@fontsource/inconsolata/700.css')]),
  'Roboto Mono':      () => Promise.all([import('@fontsource/roboto-mono/400.css'), import('@fontsource/roboto-mono/700.css')]),
  'Geist Mono':       () => Promise.all([import('@fontsource/geist-mono/400.css'), import('@fontsource/geist-mono/700.css')]),
  'Noto Sans Mono':   () => Promise.all([import('@fontsource/noto-sans-mono/400.css'), import('@fontsource/noto-sans-mono/700.css')]),
  'Ubuntu Mono':      () => Promise.all([import('@fontsource/ubuntu-mono/400.css'), import('@fontsource/ubuntu-mono/700.css')]),
  'Victor Mono':      () => Promise.all([import('@fontsource/victor-mono/400.css'), import('@fontsource/victor-mono/700.css')]),
  'Space Mono':       () => Promise.all([import('@fontsource/space-mono/400.css'), import('@fontsource/space-mono/700.css')]),
  'Anonymous Pro':    () => Promise.all([import('@fontsource/anonymous-pro/400.css'), import('@fontsource/anonymous-pro/700.css')]),
  'Red Hat Mono':     () => Promise.all([import('@fontsource/red-hat-mono/400.css'), import('@fontsource/red-hat-mono/700.css')]),
  'Cousine':          () => Promise.all([import('@fontsource/cousine/400.css'), import('@fontsource/cousine/700.css')]),
  'Courier Prime':    () => Promise.all([import('@fontsource/courier-prime/400.css'), import('@fontsource/courier-prime/700.css')]),
  'VT323':            () => import('@fontsource/vt323/400.css'),  // 700 yok
};

const loadedFonts = new Set<string>(['JetBrains Mono']);

/** İstenen family için font CSS'lerini bir kez yükler. Çağrı tekrar edilirse
 *  no-op. SettingsModal font seçimi + AppShell mount sırasında çağrılır. */
export async function ensureFontLoaded(family: string): Promise<void> {
  if (loadedFonts.has(family)) return;
  const loader = FONT_LOADERS[family];
  if (!loader) {
    // Kullanıcı bilinmeyen bir family girdi (sistem fontu) — fallback chain
    // zaten devreye giriyor, yapılacak iş yok.
    return;
  }
  try {
    await loader();
    loadedFonts.add(family);
  } catch (e) {
    // Network hatası vs.: sessiz geç, fallback chain devreye girer.
    if (typeof console !== 'undefined') {
      console.warn(`font load failed: ${family}`, e);
    }
  }
}

export interface BundledFont {
  family: string;
  label: string;
  license: string;
  /** Ligature destekliyor mu */
  ligatures: boolean;
  /** Çoklu dil (Latin extended, Cyrillic, Greek vb.) tam destek */
  multiScript: boolean;
  /** Stilistik açıklama */
  hint: string;
}

export const BUNDLED_FONTS: BundledFont[] = [
  // — Programlama (popüler) —
  { family: 'JetBrains Mono', label: 'JetBrains Mono', license: 'Apache 2.0', ligatures: true,  multiScript: true,  hint: 'JetBrains, modern, ligature' },
  { family: 'Fira Code',      label: 'Fira Code',      license: 'OFL',        ligatures: true,  multiScript: true,  hint: 'Mozilla, ligature, terminal klasik' },
  { family: 'Cascadia Code',  label: 'Cascadia Code',  license: 'OFL',        ligatures: true,  multiScript: true,  hint: 'Microsoft, Win11 default' },
  { family: 'Geist Mono',     label: 'Geist Mono',     license: 'OFL',        ligatures: true,  multiScript: false, hint: 'Vercel, modern minimal' },
  { family: 'Victor Mono',    label: 'Victor Mono',    license: 'OFL',        ligatures: true,  multiScript: false, hint: 'Cursive italic, dev favori' },
  { family: 'IBM Plex Mono',  label: 'IBM Plex Mono',  license: 'OFL',        ligatures: false, multiScript: true,  hint: 'IBM, kurumsal, geniş Unicode' },
  { family: 'Source Code Pro',label: 'Source Code Pro',license: 'OFL',        ligatures: false, multiScript: true,  hint: 'Adobe, klasik dev font' },
  { family: 'Roboto Mono',    label: 'Roboto Mono',    license: 'Apache 2.0', ligatures: false, multiScript: true,  hint: 'Google, geometric' },
  { family: 'Inconsolata',    label: 'Inconsolata',    license: 'OFL',        ligatures: false, multiScript: true,  hint: 'Klasik humanist' },
  { family: 'Red Hat Mono',   label: 'Red Hat Mono',   license: 'OFL',        ligatures: false, multiScript: true,  hint: 'Red Hat, kurumsal' },

  // — Çoklu dil king —
  { family: 'Noto Sans Mono', label: 'Noto Sans Mono', license: 'OFL',        ligatures: false, multiScript: true,  hint: 'Google Noto — TR/RU/EL/AR/CJK fallback' },

  // — Linux/terminal klasikleri —
  { family: 'Ubuntu Mono',    label: 'Ubuntu Mono',    license: 'UFL',        ligatures: false, multiScript: true,  hint: 'Linux klasik, Canonical' },
  { family: 'Cousine',        label: 'Cousine',        license: 'Apache 2.0', ligatures: false, multiScript: true,  hint: 'Liberation Mono benzeri' },
  { family: 'Courier Prime',  label: 'Courier Prime',  license: 'OFL',        ligatures: false, multiScript: true,  hint: 'Yenilenmiş Courier' },
  { family: 'Anonymous Pro',  label: 'Anonymous Pro',  license: 'OFL',        ligatures: false, multiScript: true,  hint: 'Klasik kod editör' },

  // — Stil/retro —
  { family: 'Space Mono',     label: 'Space Mono',     license: 'OFL',        ligatures: false, multiScript: true,  hint: 'Google, retro NASA hissi' },
  { family: 'VT323',          label: 'VT323',          license: 'OFL',        ligatures: false, multiScript: false, hint: 'CRT pixel, retro terminal' },
];

export const DEFAULT_FONT_FAMILY = 'JetBrains Mono';

/** xterm + UI için fallback chain. Primary kullanıcı seçimi, gerisi sistem ihtiyatı. */
export function fallbackChain(primary: string): string {
  // Noto Sans Mono'yu fallback'e ekleyerek non-Latin script (TR/RU/EL/AR/CJK)
  // garantili gösterilir, primary font glyph'ı eksikse devreye girer.
  return `"${primary}", "Noto Sans Mono", "Cascadia Code", "Cascadia Mono", "Consolas", "Courier New", monospace`;
}
