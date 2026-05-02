<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { listen } from '@tauri-apps/api/event';
import { api } from '@/api/tauri';
import type { LeafNode, PaneType } from '@/types/pane';
import type { PtyEvent } from '@/types/events';
import { usePanesStore } from '@/stores/panes';
import { useThemeStore } from '@/stores/theme';
import { useSettingsStore } from '@/stores/settings';
import { xtermThemeOf } from '@/themes/apply';

const props = defineProps<{ leaf: LeafNode }>();
const panes = usePanesStore();
const themeStore = useThemeStore();
const settings = useSettingsStore();

const container = ref<HTMLDivElement>();
let term: Terminal | null = null;
let fit: FitAddon | null = null;
let unlistenStdout: UnlistenFn | null = null;

const SHELL_OF: Record<PaneType, { shell: string; args: string[] }> = {
  powershell: { shell: 'powershell.exe', args: ['-NoLogo'] },
  cmd: { shell: 'cmd.exe', args: [] },
  wsl: { shell: 'wsl.exe', args: [] },
  // diğerleri terminal değil, bu component yüklenmemeli
  aiChat: { shell: '', args: [] },
  logStream: { shell: '', args: [] },
  welcome: { shell: '', args: [] },
};

async function spawn() {
  if (!term || !fit || !container.value) return;
  fit.fit();
  const { cols, rows } = term;
  const cfg = SHELL_OF[props.leaf.type];
  panes.setLeafState(props.leaf.id, { status: 'spawning' });
  try {
    const ptyId = await api.ptySpawn({
      shell: cfg.shell,
      args: cfg.args,
      cols,
      rows,
    });
    panes.setLeafState(props.leaf.id, { ptyId, status: 'running' });
    await listenStdout(ptyId);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    panes.setLeafState(props.leaf.id, { status: 'error', errorMessage: msg });
  }
}

async function listenStdout(ptyId: string) {
  if (unlistenStdout) {
    unlistenStdout();
    unlistenStdout = null;
  }
  unlistenStdout = await listen<PtyEvent>('pty://stdout', (e) => {
    if (e.payload.kind !== 'stdout') return;
    if (e.payload.pane_id !== ptyId) return;
    if (!term) return;
    // data: number[] (Vec<u8>) — Uint8Array'e çevir, xterm.js byte stream kabul eder
    term.write(new Uint8Array(e.payload.data));
  });
}

function attachInput() {
  if (!term) return;
  term.onData((data) => {
    const ptyId = panes.getLeaf(props.leaf.id)?.ptyId;
    if (!ptyId) return;
    api.ptyWrite(ptyId, new TextEncoder().encode(data)).catch(() => {});
  });
  term.onResize(({ cols, rows }) => {
    const ptyId = panes.getLeaf(props.leaf.id)?.ptyId;
    if (!ptyId) return;
    api.ptyResize(ptyId, cols, rows).catch(() => {});
  });
}

function handleResize() {
  if (!fit) return;
  try {
    fit.fit();
  } catch {
    /* container görünür değilse atla */
  }
}

onMounted(async () => {
  if (!container.value) return;
  const xtheme = themeStore.active ? xtermThemeOf(themeStore.active) : undefined;
  term = new Terminal({
    fontFamily: settings.state.fontFamily,
    fontSize: settings.state.fontSize,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 10000,
    theme: xtheme,
    allowProposedApi: true,
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());
  term.open(container.value);
  attachInput();
  window.addEventListener('resize', handleResize);
  await spawn();
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  if (unlistenStdout) unlistenStdout();
  term?.dispose();
});

// Tema değişiminde xterm tema güncelle
watch(
  () => themeStore.active,
  (next) => {
    if (term && next) {
      term.options.theme = xtermThemeOf(next);
    }
  },
);

watch(
  () => [settings.state.fontFamily, settings.state.fontSize] as const,
  ([family, size]) => {
    if (term) {
      term.options.fontFamily = family;
      term.options.fontSize = size;
      handleResize();
    }
  },
);
</script>

<template>
  <div ref="container" class="terminal" />
</template>

<style scoped>
.terminal {
  flex: 1;
  min-width: 0;
  min-height: 0;
  background: var(--color-bg);
  padding: 4px;
}
:deep(.xterm) {
  height: 100%;
}
:deep(.xterm-viewport) {
  background-color: var(--color-bg) !important;
}
</style>
