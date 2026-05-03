<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useContextMenu, type MenuEntry } from '@/composables/useContextMenu';

const { state, hide } = useContextMenu();

const menuEl = ref<HTMLDivElement>();
const adjusted = ref<{ x: number; y: number }>({ x: 0, y: 0 });

function isAction(e: MenuEntry): e is Exclude<MenuEntry, { kind: 'separator' }> {
  return e.kind !== 'separator';
}

async function adjustPosition() {
  await nextTick();
  if (!menuEl.value) return;
  const rect = menuEl.value.getBoundingClientRect();
  let x = state.x;
  let y = state.y;
  if (x + rect.width > window.innerWidth - 8) x = window.innerWidth - rect.width - 8;
  if (y + rect.height > window.innerHeight - 8) y = window.innerHeight - rect.height - 8;
  adjusted.value = { x, y };
}

watch(() => state.open, async (open) => {
  if (open) await adjustPosition();
});

function onWindowClick(e: MouseEvent) {
  if (!state.open) return;
  if (menuEl.value && menuEl.value.contains(e.target as Node)) return;
  hide();
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') hide();
}

onMounted(() => {
  window.addEventListener('mousedown', onWindowClick, true);
  window.addEventListener('keydown', onKey);
  window.addEventListener('blur', hide);
  window.addEventListener('resize', hide);
});
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onWindowClick, true);
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('blur', hide);
  window.removeEventListener('resize', hide);
});

async function invoke(action: Exclude<MenuEntry, { kind: 'separator' }>) {
  if (action.disabled) return;
  hide();
  await action.onClick();
}

const style = computed(() => ({
  left: `${adjusted.value.x}px`,
  top: `${adjusted.value.y}px`,
}));
</script>

<template>
  <Teleport to="body">
    <div v-if="state.open" ref="menuEl" class="ctx-menu" :style="style" role="menu">
      <template v-for="(entry, idx) in state.items" :key="idx">
        <div v-if="entry.kind === 'separator'" class="ctx-menu__sep" />
        <button
          v-else
          type="button"
          class="ctx-menu__item"
          :class="{ 'is-danger': entry.danger, 'is-disabled': entry.disabled }"
          :disabled="entry.disabled"
          @mousedown.prevent
          @click="invoke(entry)"
        >
          <span class="ctx-menu__icon">{{ entry.icon ?? '' }}</span>
          <span class="ctx-menu__label">{{ entry.label }}</span>
          <span v-if="entry.shortcut" class="ctx-menu__shortcut">{{ entry.shortcut }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  z-index: 1000;
  min-width: 200px;
  max-width: 320px;
  padding: 4px 0;
  background: rgba(10, 14, 26, 0.96);
  border: 1px solid rgba(0, 180, 216, 0.35);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(0, 0, 0, 0.5);
  font-family: var(--font-family);
  font-size: 11px;
  color: var(--color-fg);
  user-select: none;
  backdrop-filter: blur(12px);
}
.ctx-menu__sep {
  height: 1px;
  margin: 4px 0;
  background: var(--color-line);
}
.ctx-menu__item {
  display: grid;
  grid-template-columns: 18px 1fr auto;
  gap: 10px;
  align-items: center;
  width: 100%;
  padding: 4px 12px;
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  font-family: inherit;
  font-size: inherit;
  text-align: left;
  line-height: 1.6;
}
.ctx-menu__item:hover {
  background: rgba(0, 180, 216, 0.15);
  color: var(--color-accent);
}
.ctx-menu__item.is-danger:hover {
  background: rgba(255, 95, 87, 0.15);
  color: var(--color-red);
}
.ctx-menu__item.is-disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ctx-menu__icon {
  text-align: center;
  color: var(--color-dim);
  font-size: 11px;
}
.ctx-menu__item:hover .ctx-menu__icon {
  color: inherit;
}
.ctx-menu__shortcut {
  color: var(--color-dim);
  font-size: 10px;
}
</style>
