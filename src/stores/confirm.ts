// Generic onay dialog'u — singleton request queue.
//
// `confirmAsk()` (utils/dialog.ts) çağrılınca burada bir pending request
// oluşur ve Promise döndürür. ConfirmDialog.vue tek instance halinde
// AppShell'de mount'lu durur; pending değişince render eder, kullanıcı
// butona basınca `resolve(v)` çağırır → Promise tamamlanır.
//
// Tasarım kararları:
// - Tek pending olabilir (FIFO queue YOK) — UI overlap'i engeller. Aynı anda
//   ikinci request gelirse önceki false'la resolve edilip yenisi kuyruğa
//   alınmaz; ardışık olarak istense yeniden çağrılır.
// - `kind` yok kabul edilince warning default (mevcut çağıranların %90'ı bu).
// - Title verilmezse ConfirmDialog kendi `t('common.confirmTitle')` fallback
//   ile gösterir; locale dosyasına ekleyeceğiz.

import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ConfirmKind = 'info' | 'warning' | 'error' | 'question';

export interface ConfirmOptions {
  /** Modal başlığı. Boşsa "common.confirmTitle" i18n key'i kullanılır. */
  title?: string;
  /** İkon + renk seçer. Default `warning`. */
  kind?: ConfirmKind;
  /** Onay butonu label'ı. Boşsa `common.confirm`. */
  confirmLabel?: string;
  /** İptal butonu label'ı. Boşsa `common.cancel`. */
  cancelLabel?: string;
  /** Onay butonu destructive ise kırmızıya boya (silme vb.). */
  danger?: boolean;
}

export interface ConfirmRequest {
  id: number;
  message: string;
  options: ConfirmOptions;
}

let nextId = 1;

export const useConfirmStore = defineStore('confirm', () => {
  const pending = ref<ConfirmRequest | null>(null);
  // Resolver Vue reactive değil; ref dışı tutuyoruz (function değer reactive'e
  // serialize olmaz, lint warning yaratır).
  let resolver: ((value: boolean) => void) | null = null;

  function request(message: string, options: ConfirmOptions = {}): Promise<boolean> {
    // Önceki istek varsa false'la kapat — overlap engelle.
    if (resolver) {
      resolver(false);
      resolver = null;
    }
    return new Promise<boolean>((resolve) => {
      resolver = resolve;
      pending.value = { id: nextId++, message, options };
    });
  }

  function resolve(value: boolean): void {
    const r = resolver;
    resolver = null;
    pending.value = null;
    if (r) r(value);
  }

  return { pending, request, resolve };
});
