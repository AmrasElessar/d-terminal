<script setup lang="ts">
// Global ConfirmDialog — singleton, AppShell'de tek instance.
//
// Store'daki `pending` request'i dinler; her değişiklikte modal'ı render eder.
// Eski Tauri native Win32 TaskDialog'un yerine geçer — uygulamanın temasına
// (Mica + accent + DPI-uyumlu xterm font'u) uyumlu.
//
// Etkileşim:
// - Onayla butonu / Enter  → resolve(true)
// - İptal butonu / Esc     → resolve(false)
// - Overlay'e click (panel dışı) → resolve(false)
// - `danger` true → onayla butonu kırmızı (destructive aksiyon işareti)
//
// Aksesibilite: role="alertdialog", aria-labelledby başlık, aria-describedby
// mesaj, autofocus iptal butonunda (yıkıcı varsayım yapma — kullanıcı kasıtlı
// onaylamalı, kazara Enter'a basılıp veri silinmesin).

import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useConfirmStore } from '@/stores/confirm';

const { t } = useI18n();
const store = useConfirmStore();

const open = computed(() => store.pending !== null);
const message = computed(() => store.pending?.message ?? '');
const opts = computed(() => store.pending?.options ?? {});
const kind = computed(() => opts.value.kind ?? 'warning');
const title = computed(() => opts.value.title || t('common.confirmTitle'));
const confirmLabel = computed(() => opts.value.confirmLabel || t('common.confirm'));
const cancelLabel = computed(() => opts.value.cancelLabel || t('common.cancel'));
const danger = computed(() => opts.value.danger === true);

// İkon — kind'a göre. Unicode emoji yerine SVG/karakter sembol (font-stack
// uyumu için): warning/error/info/question.
const icon = computed(() => {
  switch (kind.value) {
    case 'error':    return '✕';
    case 'info':     return 'ℹ';
    case 'question': return '?';
    case 'warning':
    default:         return '⚠';
  }
});

const cancelBtn = ref<HTMLButtonElement | null>(null);
const confirmBtn = ref<HTMLButtonElement | null>(null);

// Açılışta iptal butonuna fokus ver — yıkıcı aksiyonda kazara Enter koruması.
// `danger=false` ise confirm butonu da kabul edilebilir bir fokus ama iptal
// daha güvenli default; kullanıcı sekmeyle confirm'e geçer.
watch(open, async (isOpen) => {
  if (!isOpen) return;
  await nextTick();
  cancelBtn.value?.focus();
});

function onCancel() {
  store.resolve(false);
}
function onConfirm() {
  store.resolve(true);
}

// ESC global → cancel. window-level listener ekleyip kapanışta kaldır.
// (Modal `<dialog>` element'i tarayıcının native ESC davranışını bazen yutuyor
// — programatik açıldığımız için keydown global olarak takip ediyoruz.)
function onKeydown(e: KeyboardEvent) {
  if (!open.value) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    onCancel();
  } else if (e.key === 'Enter') {
    // Default action = confirm. Ama dangerous + cancelBtn focused ise yine cancel.
    e.preventDefault();
    const activeIsCancel = document.activeElement === cancelBtn.value;
    if (activeIsCancel) onCancel();
    else onConfirm();
  }
}

window.addEventListener('keydown', onKeydown, true);
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true));
</script>

<template>
  <dialog v-if="open" class="confirm" open @click.self="onCancel">
    <article
      class="confirm__panel"
      role="alertdialog"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-msg"
    >
      <header class="confirm__head" :class="`kind-${kind}`">
        <span class="confirm__icon" aria-hidden="true">{{ icon }}</span>
        <h2 id="confirm-title">{{ title }}</h2>
      </header>
      <p id="confirm-msg" class="confirm__msg">{{ message }}</p>
      <div class="confirm__actions">
        <button
          ref="cancelBtn"
          type="button"
          class="ghost"
          @click="onCancel"
        >
          {{ cancelLabel }}
        </button>
        <button
          ref="confirmBtn"
          type="button"
          class="primary"
          :class="{ danger }"
          @click="onConfirm"
        >
          {{ confirmLabel }}
        </button>
      </div>
    </article>
  </dialog>
</template>

<style scoped>
.confirm {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  background: var(--color-overlay-medium);
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  padding: 0;
  /* z-index: MigrationDialog (110) + 10 — confirm her şeyin üstünde olsun.
     Settings/Snippet modal'larından da yukarı çıkar çünkü onların içinden
     silme onayı tetiklenebiliyor (SessionModal.remove(), SnippetModal.remove). */
  z-index: 120;
}
.confirm__panel {
  background: var(--color-bg);
  border: 1px solid color-mix(in srgb, var(--color-fg) 8%, transparent);
  border-radius: var(--ui-radius, 8px);
  padding: 18px 20px 16px;
  min-width: 360px;
  max-width: 520px;
  color: var(--color-fg);
  box-shadow: 0 8px 32px var(--color-overlay-dark);
}
.confirm__head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 10px 0;
}
.confirm__head h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.confirm__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  font-size: 14px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-fg) 8%, transparent);
}
/* Kind-spesifik renkler — accent yerine tematik tonlar. */
.kind-warning .confirm__icon {
  color: var(--color-yellow);
  background: color-mix(in srgb, var(--color-yellow) 12%, transparent);
}
.kind-error .confirm__icon {
  color: var(--color-red);
  background: var(--color-red-soft-15);
}
.kind-info .confirm__icon {
  color: var(--color-accent);
  background: var(--color-accent-soft-12);
}
.kind-question .confirm__icon {
  color: var(--color-fg);
}
.confirm__msg {
  margin: 0 0 14px 0;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;     /* tek mesajda \n korunsun */
  word-break: break-word;
}
.confirm__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.confirm__actions button {
  padding: 6px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  border: 1px solid transparent;
  font-size: 11px;
  min-width: 84px;
}
.ghost {
  background: transparent;
  color: var(--color-fg);
  /* WCAG 1.4.11 (Non-text Contrast): UI komponent kenarlığı min 3:1.
     Önceki `10%` D-Dark zemininde ~1.1:1 (fail). `28%` ile ~3.2:1. */
  border-color: color-mix(in srgb, var(--color-fg) 28%, transparent);
}
.ghost:hover {
  background: color-mix(in srgb, var(--color-fg) 6%, transparent);
}
.primary {
  background: var(--color-accent);
  color: var(--color-bg);
  font-weight: 600;
}
.primary:hover {
  filter: brightness(1.1);
}
.primary.danger {
  background: var(--color-red);
  color: var(--color-bg);
}
.primary.danger:hover {
  filter: brightness(1.1);
}
</style>
