// In-app onay dialog'u — uygulama temasıyla uyumlu.
//
// Eskiden @tauri-apps/plugin-dialog'un `ask()` fonksiyonu (Win32 TaskDialog)
// çağrılırdı; ama bu native dialog frameless Tauri penceresinde görsel
// kopukluk yaratıyordu (eski Windows estetiği, accent rengini almıyor,
// Mica/Acrylic'i bozuyor, DPI scaling tutarsız). Şimdi `useConfirmStore`
// üzerinden ConfirmDialog.vue (AppShell'de singleton) render ediliyor.
//
// API uyumluluğu: imza ESKİ haliyle aynı — 8 çağrı yerinde değişiklik yok.

import { useConfirmStore, type ConfirmKind } from '@/stores/confirm';

export interface ConfirmAskOptions {
  /** Modal başlığı. Boşsa "common.confirmTitle" i18n key'i kullanılır. */
  title?: string;
  /** İkon + ton rengi. Default `warning`. */
  kind?: ConfirmKind;
  /** Onay butonu label'ı. Boşsa `common.confirm`. */
  confirmLabel?: string;
  /** İptal butonu label'ı. Boşsa `common.cancel`. */
  cancelLabel?: string;
  /** Onay butonu yıkıcı (silme gibi) — kırmızıya boyar. */
  danger?: boolean;
}

/**
 * Onay dialog'u göster ve kullanıcı kararını Promise<boolean> olarak döndür.
 * Uygulama temasıyla render edilir (in-app modal, Tauri native değil).
 *
 * Eski imza korunur: `confirmAsk(msg)` ve `confirmAsk(msg, { kind })` aynen
 * çalışır. Yeni opsiyonel alanlar: `confirmLabel`, `cancelLabel`, `danger`.
 */
export async function confirmAsk(
  message: string,
  options?: ConfirmAskOptions,
): Promise<boolean> {
  // Pinia store'a setup-store olarak erişiyoruz; Pinia mount edilmeden
  // çağrılırsa hata. Setup-store global erişim için lazy fetch yeterli;
  // composition API dışı çağrılarda da çalışır (Pinia createPinia tek
  // örnek; main.ts'de mount'lu).
  const store = useConfirmStore();
  return store.request(message, options);
}
