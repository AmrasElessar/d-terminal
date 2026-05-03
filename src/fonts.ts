// Bundled developer mono fonts (self-hosted via @fontsource).
// 17 popüler programcı fontu — Regular (400) + Bold (700).

import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/fira-code/400.css';
import '@fontsource/fira-code/700.css';
import '@fontsource/cascadia-code/400.css';
import '@fontsource/cascadia-code/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/700.css';
import '@fontsource/source-code-pro/400.css';
import '@fontsource/source-code-pro/700.css';
import '@fontsource/inconsolata/400.css';
import '@fontsource/inconsolata/700.css';
import '@fontsource/roboto-mono/400.css';
import '@fontsource/roboto-mono/700.css';
import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/700.css';
import '@fontsource/noto-sans-mono/400.css';
import '@fontsource/noto-sans-mono/700.css';
import '@fontsource/ubuntu-mono/400.css';
import '@fontsource/ubuntu-mono/700.css';
import '@fontsource/victor-mono/400.css';
import '@fontsource/victor-mono/700.css';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';
import '@fontsource/anonymous-pro/400.css';
import '@fontsource/anonymous-pro/700.css';
import '@fontsource/red-hat-mono/400.css';
import '@fontsource/red-hat-mono/700.css';
import '@fontsource/cousine/400.css';
import '@fontsource/cousine/700.css';
import '@fontsource/courier-prime/400.css';
import '@fontsource/courier-prime/700.css';
import '@fontsource/vt323/400.css'; // 700 yok — sadece tek weight

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
