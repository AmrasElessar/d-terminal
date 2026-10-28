// Dış bağlantı açma — tek güvenli giriş noktası.
//
// Terminal çıktısı, AI cevapları ve log satırları saldırgan kontrolünde
// olabilir. Bu yüzden:
//   - yalnızca http(s) ve mailto URL'leri sistem tarayıcısında / e-posta
//     istemcisinde açılır (`javascript:`, `file:`, `ms-*:` protokol
//     handler'ları, UNC, dosya yolları reddedilir — backend shell scope'u da
//     yalnızca bunlara izin verir);
//   - WebView2 içinde `window.open` / `target=_blank` popup'ı açılmaz
//     (uygulama origin'inde yabancı sayfa çalışmasın).

import { open as shellOpen } from '@tauri-apps/plugin-shell';

/** http(s) / mailto URL'i normalize eder; değilse null. */
export function safeHttpUrl(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol === 'mailto:') return u.href;
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

/** Uygulama genelinde `<a href>` tıklamalarını yakala: dış bağlantılar
 *  WebView2 popup'ı yerine sistem tarayıcısında açılır, diğer şemalar
 *  engellenir. main.ts'de bir kez kurulur. */
export function installExternalLinkHandler(root: Document = document): () => void {
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button > 1) return;
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#') || href === '') return;
    e.preventDefault();
    void openExternalUrl(a.href);
  };
  root.addEventListener('click', onClick);
  root.addEventListener('auxclick', onClick);
  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('auxclick', onClick);
  };
}
