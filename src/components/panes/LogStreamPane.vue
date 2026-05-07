<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Channel } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import type { LeafNode } from '@/types/pane';
import { api } from '@/api/tauri';
import { useToastsStore } from '@/stores/toasts';
import { formatError } from '@/utils/error';

const props = defineProps<{ leaf: LeafNode }>();
const { t } = useI18n();
const toasts = useToastsStore();

const filePath = ref<string>('');
const tailMode = ref(true);
const filterRegex = ref('');
const lines = ref<string[]>([]);
const watching = ref(false);
const autoScroll = ref(true);
const scrollContainer = ref<HTMLDivElement>();
let channel: Channel<string> | null = null;

const MAX_LINES = 5000;
const filterRe = computed<RegExp | null>(() => {
  if (!filterRegex.value) return null;
  try { return new RegExp(filterRegex.value, 'i'); }
  catch { return null; }
});
const filteredLines = computed(() => {
  const re = filterRe.value;
  if (!re) return lines.value;
  return lines.value.filter((l) => re.test(l));
});

async function pickFile() {
  const selected = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: 'Log files', extensions: ['log', 'txt', '*'] }],
  });
  if (typeof selected === 'string') {
    filePath.value = selected;
  }
}

async function startWatch() {
  if (!filePath.value || watching.value) return;
  channel = new Channel<string>();
  channel.onmessage = (line) => {
    lines.value.push(line);
    if (lines.value.length > MAX_LINES) {
      lines.value.splice(0, lines.value.length - MAX_LINES);
    }
    if (autoScroll.value) {
      requestAnimationFrame(() => {
        const el = scrollContainer.value;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  };
  try {
    await api.logStreamOpen(props.leaf.id, filePath.value, tailMode.value, channel);
    watching.value = true;
    toasts.success(t('logStream.started'));
  } catch (e: unknown) {
    toasts.error(t('logStream.failed', { message: formatError(e) }));
  }
}

async function stopWatch() {
  if (!watching.value) return;
  await api.logStreamClose(props.leaf.id).catch(() => {});
  watching.value = false;
  channel = null;
}

function clearLines() {
  lines.value = [];
}

function onScroll() {
  const el = scrollContainer.value;
  if (!el) return;
  const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop <= 32;
  autoScroll.value = atBottom;
}

onBeforeUnmount(() => {
  if (watching.value) {
    api.logStreamClose(props.leaf.id).catch(() => {});
  }
});
</script>

<template>
  <div class="log-pane">
    <header class="log-pane__toolbar">
      <input
        v-model="filePath"
        type="text"
        class="log-pane__path"
        :placeholder="t('logStream.pathPlaceholder')"
        spellcheck="false"
        :disabled="watching"
      />
      <button type="button" class="ghost" :disabled="watching" @click="pickFile">📁</button>
      <label class="check">
        <input v-model="tailMode" type="checkbox" :disabled="watching" />
        <span>{{ t('logStream.tailMode') }}</span>
      </label>
      <button v-if="!watching" type="button" class="primary" :disabled="!filePath" @click="startWatch">
        ▶ {{ t('logStream.start') }}
      </button>
      <button v-else type="button" class="danger" @click="stopWatch">
        ■ {{ t('logStream.stop') }}
      </button>
      <button type="button" class="ghost" :disabled="lines.length === 0" @click="clearLines">⌫</button>
    </header>

    <header class="log-pane__filter">
      <span>{{ t('logStream.filter') }}:</span>
      <input
        v-model="filterRegex"
        type="text"
        class="log-pane__filter-input"
        :placeholder="t('logStream.filterPlaceholder')"
        spellcheck="false"
      />
      <span class="meta">{{ filteredLines.length }} / {{ lines.length }}</span>
      <span class="meta" :class="{ 'auto-scroll': autoScroll }">
        {{ autoScroll ? t('logStream.followingTail') : t('logStream.scrolledUp') }}
      </span>
    </header>

    <div ref="scrollContainer" class="log-pane__lines" @scroll="onScroll">
      <p v-if="lines.length === 0 && !watching" class="empty">{{ t('logStream.empty') }}</p>
      <div v-for="(line, idx) in filteredLines" :key="idx" class="line">{{ line }}</div>
    </div>
  </div>
</template>

<style scoped>
.log-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: transparent;
  font-family: var(--font-family);
  color: var(--color-fg);
}
.log-pane__toolbar,
.log-pane__filter {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--color-line);
  font-size: 11px;
  background: rgba(0, 0, 0, 0.25);
}
.log-pane__path {
  flex: 1;
  background: var(--color-overlay-light);
  border: 1px solid var(--color-line);
  color: var(--color-fg);
  padding: 4px 8px;
  border-radius: 3px;
  font-family: inherit;
  font-size: 11px;
}
.log-pane__path:focus { outline: none; border-color: var(--color-accent); }
.log-pane__filter-input {
  flex: 1;
  background: var(--color-overlay-faint);
  border: 1px solid var(--color-line);
  color: var(--color-fg);
  padding: 3px 6px;
  border-radius: 3px;
  font-family: inherit;
  font-size: 11px;
}
.check { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--color-dim); }
.meta { font-size: 10px; color: var(--color-dim); }
.meta.auto-scroll { color: var(--color-green); }
.log-pane__lines {
  flex: 1;
  overflow-y: auto;
  padding: 6px 10px;
  font-size: 11px;
  line-height: 1.4;
}
.line {
  white-space: pre;
  font-family: var(--font-family);
}
.line:hover { background: color-mix(in srgb, var(--color-fg) 3%, transparent); }
.empty { text-align: center; color: var(--color-dim); padding: 32px; }
.primary { background: var(--color-accent); color: var(--color-bg); border: none; padding: 4px 10px; border-radius: 3px; font-weight: 600; cursor: pointer; }
.primary:disabled { opacity: 0.4; cursor: not-allowed; }
.ghost { background: transparent; color: var(--color-fg); border: 1px solid var(--color-line); padding: 4px 8px; border-radius: 3px; cursor: pointer; }
.ghost:disabled { opacity: 0.4; cursor: not-allowed; }
.danger { background: var(--color-red); color: var(--color-bg); border: none; padding: 4px 10px; border-radius: 3px; font-weight: 600; cursor: pointer; }
</style>
