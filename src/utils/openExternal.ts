// Dış bağlantı açma — tek güvenli giriş noktası.
//
// Terminal çıktısı, AI cevapları ve log satırları saldırgan kontrolünde
// olabilir. Bu yüzden:
//   - yalnızca http(s) URL'leri sistem tarayıcısında açılır (`javascript:`,
//     `file:`, `ms-*:` protokol handler'ları, UNC vb. reddedilir);
//   - WebView2 içinde `window.open` popup'ı açılmaz (uygulama origin'inde
//     saldırgan sayfası çalışmasın).
//   - Dosya yolları yalnızca açıkça izinli, çalıştırılamaz uzantılarla açılır.

import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { isSafeLocalDrivePath } from '@/composables/useGitStat';

/** http/https URL'i normalize eder; değilse null. */
export function safeHttpUrl(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname) return null;
  // Kimlik bilgisi gömülü URL'ler (https://user:pass@host) phishing'de kullanılır
  if (u.username || u.password) return null;
  return u.href;
}

/** URL'i sistem tarayıcısında açar. Geçersizse false. */
export async function openExternalUrl(raw: string): Promise<boolean> {
  const href = safeHttpUrl(raw);
  if (!href) return false;
  try {
    await shellOpen(href);
    return true;
  } catch {
    return false;
  }
}

/** Tek tıkla açılmasında sakınca olmayan (çalıştırılamaz) uzantılar.
 *  Denylist yerine allowlist: Windows'ta `.js .jse .vbe .wsh .hta .reg .url
 *  .cpl .msc .chm .application .library-ms .search-ms ...` gibi onlarca
 *  çalıştırılabilir/handler'lı uzantı var; listeyi eksiksiz tutmak mümkün değil. */
const OPENABLE_EXTENSIONS = new Set([
  'txt', 'md', 'log', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'csv', 'tsv',
  'xml', 'rs', 'ts', 'tsx', 'vue', 'py', 'go', 'java', 'c', 'h', 'cpp', 'hpp', 'cs',
  'css', 'scss', 'sql', 'lock', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'pdf',
]);

/** Terminal'de tıklanan bir yol açılabilir mi? Yerel sürücü yolu olmalı;
 *  uzantısız (dizin) ya da allowlist'te bir uzantı taşımalı. */
export function isOpenablePath(p: string): boolean {
  if (!isSafeLocalDrivePath(p.replace(/\//g, '\\'))) return false;
  const leaf = p.split(/[\\/]/).pop() ?? '';
  const dot = leaf.lastIndexOf('.');
  if (dot <= 0) return true; // dizin veya uzantısız dosya
  return OPENABLE_EXTENSIONS.has(leaf.slice(dot + 1).toLowerCase());
}
