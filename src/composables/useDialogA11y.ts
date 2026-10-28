// Modal a11y yardımı — focus trap + restore + ARIA attribute'ları için
// tek noktadan yönetilen composable. WCAG 2.1: 2.4.3 Focus Order, 2.4.7
// Focus Visible, 2.1.2 No Keyboard Trap (escape sağlanır).
//
// Kullanım:
//   const dialogRef = ref<HTMLElement | null>(null);
//   useDialogA11y(dialogRef, () => props.open, { onEscape: () => emit('close') });
//
// Tek odak yönetimi — Tab/Shift+Tab modal içinde döngü yapar; modal kapanınca
// daha önce odaklı element geri odaklanır.

import { getCurrentScope, nextTick, onScopeDispose, watch, type Ref } from 'vue';

interface DialogA11yOptions {
  /** Escape tuşu basılınca çağrılır (kapanma sorumluluğu çağırana ait). */
  onEscape?: () => void;
  /** İlk odaklanacak elementin selector'ı. Boşsa ilk focusable bulunur. */
  initialFocus?: string;
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useDialogA11y(
  el: Ref<HTMLElement | null>,
  isOpen: () => boolean,
  options: DialogA11yOptions = {},
) {
  let lastFocused: HTMLElement | null = null;
  let listening = false;
  let disposed = false;

  function addListener() {
    if (listening || disposed) return;
    document.addEventListener('keydown', onKey, true);
    listening = true;
  }
  function removeListener() {
    if (!listening) return;
    document.removeEventListener('keydown', onKey, true);
    listening = false;
  }

  function focusables(): HTMLElement[] {
    if (!el.value) return [];
    return Array.from(el.value.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (n) => !n.hasAttribute('hidden') && n.offsetParent !== null,
    );
  }

  function onKey(e: KeyboardEvent) {
    if (disposed || !isOpen()) return;
    if (e.key === 'Escape') {
      if (options.onEscape) {
        e.preventDefault();
        e.stopPropagation();
        options.onEscape();
      }
      return;
    }
    if (e.key !== 'Tab') return;
    const list = focusables();
    const first = list[0];
    const last = list[list.length - 1];
    if (!first || !last) {
      e.preventDefault();
      return;
    }
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (active === first || !el.value?.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !el.value?.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }

  watch(
    isOpen,
    async (open) => {
      if (open) {
        lastFocused = document.activeElement as HTMLElement | null;
        await nextTick();
        if (!el.value) return;
        // ARIA: modal=true + role=dialog (HTMLDialogElement zaten role=dialog
        // taşır ama görünürlük için açık atayalım).
        if (!el.value.getAttribute('role')) el.value.setAttribute('role', 'dialog');
        el.value.setAttribute('aria-modal', 'true');
        // İlk odaklanma
        let target: HTMLElement | null = null;
        if (options.initialFocus) {
          target = el.value.querySelector<HTMLElement>(options.initialFocus);
        }
        if (!target) target = focusables()[0] ?? null;
        if (disposed) return;
        target?.focus();
        addListener();
      } else {
        removeListener();
        if (lastFocused && document.body.contains(lastFocused)) {
          lastFocused.focus();
        }
        lastFocused = null;
      }
    },
    { immediate: true },
  );

  // Modal'lar çoğunlukla `v-if` + sabit `open=true` ile mount edilir; kapanınca
  // isOpen hiç false olmadan komponent unmount olur. Listener'ı scope dispose'da
  // da kaldır — aksi halde capture-phase Escape handler'ı sonsuza kadar yaşar ve
  // terminaldeki her Esc'i yutar (vim/fzf bozuluyordu).
  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true;
      removeListener();
      if (lastFocused && document.body.contains(lastFocused)) {
        lastFocused.focus();
      }
      lastFocused = null;
    });
  }
}
