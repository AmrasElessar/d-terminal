// Tauri 2 native dialog yardımcıları.
//
// Daha önce modaller window.confirm() kullanıyordu — WebView2 frameless
// pencerede browser-style alert/confirm görsel kopuk gözüküyor (Frontend
// perf D1). @tauri-apps/plugin-dialog'un ask() native dialog açar (Windows
// task dialog), ardından kullanıcı seçimini Promise<boolean> döndürür.
//
// dialog:default + dialog:allow-ask + dialog:allow-open + dialog:allow-save
// capability'sinde mevcut.

import { ask as tauriAsk } from '@tauri-apps/plugin-dialog';

/**
 * Onay dialog'u göster. Tauri 2 native (Win32 TaskDialog) — confirm()'in
 * görsel kopukluğu yok. Title opsiyonel (default: app.title).
 */
export async function confirmAsk(
  message: string,
  options?: { title?: string; kind?: 'info' | 'warning' | 'error' },
): Promise<boolean> {
  try {
    return await tauriAsk(message, options);
  } catch {
    // Plugin yoksa veya capability izni reddederse fallback.
    return window.confirm(message);
  }
}
