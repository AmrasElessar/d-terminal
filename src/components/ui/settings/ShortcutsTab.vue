<script setup lang="ts">
// Ayarlar → Klavye kısayolları (yerinde tuş kaydedici).
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '@/stores/settings';
import { keybindings } from '@/keybindings/registry';
import { DEFAULT_SHORTCUTS } from '@/keybindings/defaults';

const { t } = useI18n();
const settings = useSettingsStore();

// --- Shortcuts editor state ---
interface ShortcutRow {
  id: string;
  combo: string;
  labelKey: string;
  defaultCombo: string;
  isOverridden: boolean;
}

const shortcutsSearch = ref('');
const shortcutEditingId = ref<string | null>(null);
const shortcutCaptureCombo = ref<string | null>(null);
const shortcutConflictWith = ref<string | null>(null);
// Tepki gözlemi için tick — registry mutate olduğunda recompute zorla
const shortcutsTick = ref(0);

const shortcutRows = computed<ShortcutRow[]>(() => {
  void shortcutsTick.value;
  const q = shortcutsSearch.value.trim().toLowerCase();
  return DEFAULT_SHORTCUTS.map((def) => {
    const current = keybindings.getCombo(def.id) ?? def.combo;
    return {
      id: def.id,
      combo: current,
      labelKey: def.labelKey,
      defaultCombo: def.combo,
      isOverridden: !!settings.state.shortcutOverrides[def.id],
    };
  }).filter((r) => {
    if (!q) return true;
    const label = t(r.labelKey).toLowerCase();
    return r.id.toLowerCase().includes(q) || label.includes(q) || r.combo.toLowerCase().includes(q);
  });
});

function startEditShortcut(id: string) {
  shortcutEditingId.value = id;
  shortcutCaptureCombo.value = null;
  shortcutConflictWith.value = null;
  // Window-level keydown ile tuş yakala
  window.addEventListener('keydown', captureShortcutKey, true);
}
// Modal Esc ile kapanırsa cancelEditShortcut çağrılmadan unmount olur →
// listener kalıcı kalır, modal yeniden açılınca duplicate handler. Bu
// onBeforeUnmount cleanup'ı leak'i kapatır (Frontend bugs Y5).
onBeforeUnmount(() => {
  window.removeEventListener('keydown', captureShortcutKey, true);
});
function cancelEditShortcut() {
  shortcutEditingId.value = null;
  shortcutCaptureCombo.value = null;
  shortcutConflictWith.value = null;
  window.removeEventListener('keydown', captureShortcutKey, true);
}
function captureShortcutKey(e: KeyboardEvent) {
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') { cancelEditShortcut(); return; }
  // Modifier-only basıldıysa atla
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  let key = e.key;
  if (key === ' ') key = 'Space';
  if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  shortcutCaptureCombo.value = parts.join('+');
}
function applyShortcut() {
  if (!shortcutEditingId.value || !shortcutCaptureCombo.value) return;
  const id = shortcutEditingId.value;
  const combo = shortcutCaptureCombo.value;
  const conflict = keybindings.setCombo(id, combo);
  if (conflict) {
    shortcutConflictWith.value = conflict;
    return;
  }
  settings.state.shortcutOverrides = {
    ...settings.state.shortcutOverrides,
    [id]: combo,
  };
  shortcutsTick.value++;
  cancelEditShortcut();
}
function resetShortcut(id: string) {
  const def = DEFAULT_SHORTCUTS.find((d) => d.id === id);
  if (!def) return;
  keybindings.setCombo(id, def.combo);
  const overrides = { ...settings.state.shortcutOverrides };
  delete overrides[id];
  settings.state.shortcutOverrides = overrides;
  shortcutsTick.value++;
}
function resetAllShortcuts() {
  for (const def of DEFAULT_SHORTCUTS) {
    keybindings.setCombo(def.id, def.combo);
  }
  settings.state.shortcutOverrides = {};
  shortcutsTick.value++;
}
</script>

<template>
  <section class="section">
    <header class="section-head">
      <strong>{{ t('settings.shortcuts.title') }}</strong>
      <button type="button" class="ghost" @click="resetAllShortcuts">
        ↺ {{ t('settings.shortcuts.reset') }}
      </button>
    </header>
    <input
      v-model="shortcutsSearch"
      type="search"
      class="prompt-input"
      :placeholder="t('settings.shortcuts.search')"
      spellcheck="false"
    />

    <div class="shortcut-list">
      <div v-for="row in shortcutRows" :key="row.id" class="shortcut-row">
        <div class="shortcut-row__info">
          <strong>{{ t(row.labelKey) }}</strong>
          <small class="dim">{{ row.id }}</small>
        </div>
        <kbd class="combo" :class="{ overridden: row.isOverridden }">{{ row.combo }}</kbd>
        <button type="button" class="ghost" @click="startEditShortcut(row.id)">
          {{ t('settings.shortcuts.edit') }}
        </button>
        <button
          v-if="row.isOverridden"
          type="button"
          class="ghost"
          :title="`${t('settings.shortcuts.reset')}: ${row.defaultCombo}`" :aria-label="`${t('settings.shortcuts.reset')}: ${row.defaultCombo}`"
          @click="resetShortcut(row.id)"
        >
↺
</button>
      </div>
    </div>
  </section>

  <!-- Shortcut capture overlay (in-place key recorder) -->
  <Teleport to="body">
    <div v-if="shortcutEditingId" class="capture-backdrop" @click.self="cancelEditShortcut">
      <div class="capture-panel">
        <h3>{{ t('settings.shortcuts.captureTitle') }}</h3>
        <p class="dim">{{ t('settings.shortcuts.captureHint') }}</p>
        <kbd v-if="shortcutCaptureCombo" class="combo big">{{ shortcutCaptureCombo }}</kbd>
        <kbd v-else class="combo big waiting">…</kbd>
        <p v-if="shortcutConflictWith" class="error">
          {{ t('settings.shortcuts.conflict', { action: shortcutConflictWith }) }}
        </p>
        <div class="capture-actions">
          <button type="button" class="ghost" @click="cancelEditShortcut">{{ t('common.cancel') }}</button>
          <button
            type="button"
            class="primary"
            :disabled="!shortcutCaptureCombo"
            @click="applyShortcut"
          >
{{ t('common.save') }}
</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped src="./settings.css"></style>
