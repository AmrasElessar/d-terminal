<script setup lang="ts">
// Karanlık temalı genel dropdown — Webview2 native `<select>` açılır listesini
// OS'un açık temasıyla beyaz çiziyor; CSS `color-scheme: dark` görmezden
// geliniyor. Bu component tüm form select'lerinin yerine kullanılır.
//
// Options:
//   value     — modelValue ile karşılaştırılan kimlik
//   label     — listede gösterilecek metin
//   badge?    — sağda gösterilecek küçük rozet (örn. "75%", "ligatures")
//   dim?      — silik göster (örn. henüz hazır olmayan dil)
//   highlight?— accent renkli rozet (örn. tamamlanmış dil için)
//   disabled? — seçilemez (provider available değilse)

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

export interface DarkSelectOption {
  value: string;
  label: string;
  badge?: string;
  dim?: boolean;
  highlight?: boolean;
  disabled?: boolean;
}

const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: DarkSelectOption[];
    placeholder?: string;
    ariaLabel?: string;
    /** Trigger'ın min genişliği — toolbar'larda darken AI provider seçici gibi
     *  fit-content davranışı isteniyorsa 'auto' verilebilir. */
    width?: 'full' | 'auto';
  }>(),
  { placeholder: '', ariaLabel: '', width: 'full' },
);

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const menu = ref<HTMLElement | null>(null);
/** Klavye ile vurgulanan satır indeksi (selected'tan farklı — focus ring). */
const focusIdx = ref(-1);

const current = computed(
  () => props.options.find((o) => o.value === props.modelValue),
);

function toggle() {
  if (open.value) {
    open.value = false;
  } else {
    openMenu();
  }
}
function openMenu() {
  open.value = true;
  // Açılışta seçili satıra odaklan, yoksa ilk seçilebilir satıra.
  const selIdx = props.options.findIndex((o) => o.value === props.modelValue);
  focusIdx.value = selIdx >= 0 ? selIdx : firstEnabled(0, 1);
}
function pick(o: DarkSelectOption) {
  if (o.disabled) return;
  emit('update:modelValue', o.value);
  open.value = false;
}
function pickByIdx(idx: number) {
  const o = props.options[idx];
  if (o) pick(o);
}
function firstEnabled(start: number, dir: 1 | -1): number {
  const n = props.options.length;
  if (n === 0) return -1;
  let i = start;
  for (let step = 0; step < n; step += 1) {
    if (i < 0) i = n - 1;
    if (i >= n) i = 0;
    if (!props.options[i]?.disabled) return i;
    i += dir;
  }
  return -1;
}
function moveFocus(delta: 1 | -1) {
  if (!open.value) return;
  const n = props.options.length;
  if (n === 0) return;
  const start = focusIdx.value < 0 ? (delta > 0 ? 0 : n - 1) : focusIdx.value + delta;
  focusIdx.value = firstEnabled(start, delta);
  scrollFocusIntoView();
}
function scrollFocusIntoView() {
  void Promise.resolve().then(() => {
    const el = menu.value?.querySelector<HTMLElement>('.ds__opt--focus');
    el?.scrollIntoView({ block: 'nearest' });
  });
}
function onDocClick(e: MouseEvent) {
  if (!root.value) return;
  if (!root.value.contains(e.target as Node)) open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) {
    e.stopPropagation();
    open.value = false;
  }
}
function onTriggerKey(e: KeyboardEvent) {
  // Trigger üzerinde klavye nav: ArrowDown/Up/Enter/Space açar; açıkken navigasyon yapar.
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!open.value) {
      openMenu();
      moveFocus(e.key === 'ArrowDown' ? 1 : -1);
    } else {
      moveFocus(e.key === 'ArrowDown' ? 1 : -1);
    }
  } else if (e.key === 'Home') {
    if (!open.value) openMenu();
    e.preventDefault();
    focusIdx.value = firstEnabled(0, 1);
    scrollFocusIntoView();
  } else if (e.key === 'End') {
    if (!open.value) openMenu();
    e.preventDefault();
    focusIdx.value = firstEnabled(props.options.length - 1, -1);
    scrollFocusIntoView();
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (!open.value) {
      openMenu();
    } else if (focusIdx.value >= 0) {
      pickByIdx(focusIdx.value);
    }
  } else if (e.key === 'Tab') {
    open.value = false;
  }
}

// Açıldığında aktif satırı görünür alana getir.
watch(open, async (isOpen) => {
  if (!isOpen) {
    focusIdx.value = -1;
    return;
  }
  await Promise.resolve();
  const el =
    menu.value?.querySelector<HTMLElement>('.ds__opt--focus') ??
    menu.value?.querySelector<HTMLElement>('.ds__opt--active');
  el?.scrollIntoView({ block: 'nearest' });
});

onMounted(() => {
  document.addEventListener('mousedown', onDocClick);
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick);
  document.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div
    ref="root"
    class="ds"
    :class="[`ds--w-${width}`, { 'ds--open': open }]"
  >
    <button
      type="button"
      class="ds__trigger"
      :aria-label="ariaLabel || undefined"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
      @keydown="onTriggerKey"
    >
      <span class="ds__current">
        {{ current?.label ?? placeholder }}
      </span>
      <span class="ds__chev" aria-hidden="true">▾</span>
    </button>
    <ul v-if="open" ref="menu" class="ds__menu" role="listbox">
      <li
        v-for="(opt, idx) in options"
        :key="opt.value"
        class="ds__opt"
        :class="{
          'ds__opt--active':   opt.value === modelValue,
          'ds__opt--focus':    idx === focusIdx,
          'ds__opt--dim':      opt.dim,
          'ds__opt--disabled': opt.disabled,
        }"
        :aria-selected="opt.value === modelValue"
        :aria-disabled="opt.disabled"
        role="option"
        @click="pick(opt)"
        @mouseenter="!opt.disabled && (focusIdx = idx)"
      >
        <span class="ds__label">{{ opt.label }}</span>
        <span
          v-if="opt.badge"
          class="ds__badge"
          :class="{ 'ds__badge--accent': opt.highlight }"
        >
          {{ opt.badge }}
        </span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
/* Renkler temaya bağlı: var(--color-fg) ve var(--color-accent) üzerinden
   color-mix ile transparan tonlar üretiliyor. Light tema (D-Light) ve dark
   tema (D-Dark, D-Matrix vb.) aynı CSS ile doğru kontrast alır.
   Webview2 (Edge 111+) color-mix destekler. */
.ds {
  position: relative;
  display: inline-block;
}
.ds--w-full { width: 100%; }
.ds--w-auto { width: auto; }
.ds__trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: color-mix(in srgb, var(--color-fg) 4%, transparent);
  color: var(--color-fg);
  border: 1px solid color-mix(in srgb, var(--color-fg) 14%, transparent);
  border-radius: 4px;
  padding: 6px 8px;
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
  text-align: left;
}
.ds__trigger:hover {
  background: color-mix(in srgb, var(--color-fg) 8%, transparent);
  border-color: color-mix(in srgb, var(--color-fg) 24%, transparent);
}
.ds--open .ds__trigger {
  border-color: var(--color-accent);
}
.ds__current {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ds__chev {
  opacity: 0.6;
  font-size: 10px;
  margin-left: 8px;
  flex-shrink: 0;
}
.ds__menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 100%;
  margin: 0;
  padding: 4px;
  list-style: none;
  /* Background: temanın koyu/açık kararını koruyacak şekilde tema bg'sinin
     üzerine fg'den hafif bir veil — light temada hafifçe gri, dark temada
     hafifçe açık bir surface görünümü. */
  background: var(--color-bg);
  background-image: linear-gradient(
    color-mix(in srgb, var(--color-fg) 5%, transparent),
    color-mix(in srgb, var(--color-fg) 5%, transparent)
  );
  color: var(--color-fg);
  border: 1px solid color-mix(in srgb, var(--color-fg) 16%, transparent);
  border-radius: 6px;
  box-shadow: 0 8px 24px color-mix(in srgb, var(--color-fg) 24%, transparent);
  max-height: 320px;
  overflow-y: auto;
  z-index: 100;
  white-space: nowrap;
}
.ds__opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  user-select: none;
  color: var(--color-fg);
}
.ds__opt:hover:not(.ds__opt--disabled) {
  background: color-mix(in srgb, var(--color-fg) 10%, transparent);
}
.ds__opt--active {
  background: color-mix(in srgb, var(--color-accent) 22%, transparent);
  font-weight: 600;
}
.ds__opt--focus:not(.ds__opt--active) {
  background: color-mix(in srgb, var(--color-fg) 12%, transparent);
}
.ds__opt--focus.ds__opt--active {
  outline: 1px solid color-mix(in srgb, var(--color-accent) 60%, transparent);
}
.ds__opt--dim .ds__label {
  color: color-mix(in srgb, var(--color-fg) 42%, transparent);
  font-weight: 400;
}
.ds__opt--disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.ds__label {
  flex: 1;
}
.ds__badge {
  font-size: 11px;
  color: color-mix(in srgb, var(--color-fg) 50%, transparent);
}
.ds__badge--accent {
  color: var(--color-accent);
}
</style>
