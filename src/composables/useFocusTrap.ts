// Modal focus trap + focus restoration composable.
//
// Açılışta:
//   1. `document.activeElement`'i kaydet (geri dönüş hedefi)
//   2. Modal panel ref'i içindeki ilk focusable elemana focus ver (veya
//      `initialFocus` ref'ine — yıkıcı aksiyonlarda iptal butonu)
//   3. Tab/Shift+Tab key'ini panel sınırlarında döndür (trap)
// Kapanışta:
//   - Saklanan elementi geri focus et (focus restoration)
//
// WCAG 2.1.2 (No Keyboard Trap) + 2.4.3 (Focus Order) için kritik.
//
// `<dialog open>` programatik açıldığı için browser native trap devreye girmez
// (`.showModal()` çağrılsaydı top-layer ve modal semantic implicit gelirdi).
// Bu composable bu boşluğu kapatır.

import { onBeforeUnmount, watch, type Ref } from 'vue';

interface FocusTrapOptions {
  /** Modal panel root element ref'i — Tab traversal bu sınırda dönecek. */
  panel: Ref<HTMLElement | null>;
  /** Açıkken `true`; trap aktif olur. */
  open: Ref<boolean>;
  /**
   * Açılışta odaklanacak element ref'i. Verilmezse panel içindeki ilk
   * focusable element. Yıkıcı aksiyon dialog'larında "cancel" butonu
   * (kazara Enter koruması).
   */
  initialFocus?: Ref<HTMLElement | null>;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableWithin(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

export function useFocusTrap(opts: FocusTrapOptions): void {
  let previousActive: HTMLElement | null = null;

  function onKeydown(e: KeyboardEvent) {
    if (!opts.open.value) return;
    if (e.key !== 'Tab') return;
    const root = opts.panel.value;
    if (!root) return;
    const focusables = focusableWithin(root);
    if (focusables.length === 0) {
      // Hiç focusable yoksa kullanıcıyı arka pencereye kaçırmamak için
      // Tab'ı yut. Pratikte modal hep en az bir buton içerir.
      e.preventDefault();
      return;
    }
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (active === first || !root.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !root.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }

  watch(
    opts.open,
    (isOpen) => {
      if (isOpen) {
        // Restore hedefini sakla — body'ye düşmesin diye HTMLElement zorla.
        previousActive = (document.activeElement as HTMLElement | null) ?? null;
        // İlk focus — initialFocus varsa onu kullan, yoksa panel'in ilk
        // focusable'ı. nextTick beklemek için microtask kuyruğu yeterli;
        // ConfirmDialog/MigrationDialog watch'unda zaten nextTick sonrası
        // bu composable'ın watcher'ı çalışır.
        queueMicrotask(() => {
          const target =
            opts.initialFocus?.value ?? focusableWithin(opts.panel.value)[0] ?? null;
          target?.focus();
        });
        window.addEventListener('keydown', onKeydown, true);
      } else {
        window.removeEventListener('keydown', onKeydown, true);
        // Focus restoration — eski element hâlâ DOM'da ve focusable ise.
        const target = previousActive;
        previousActive = null;
        if (target && document.contains(target) && typeof target.focus === 'function') {
          target.focus();
        }
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown, true);
  });
}
