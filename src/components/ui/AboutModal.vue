<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '@/api/tauri';
import type { SystemInfo } from '@/types/events';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const info = ref<SystemInfo | null>(null);
const logPaths = ref<{ directory: string; current_file: string } | null>(null);

const version = computed(() => info.value?.d_terminal_version ?? '0.1.0-alpha');

const credits = [
  { label: 'Tauri', url: 'https://tauri.app',           note: 'Desktop shell (Rust + WebView2)' },
  { label: 'Vue 3', url: 'https://vuejs.org',           note: 'UI framework' },
  { label: 'xterm.js', url: 'https://xtermjs.org',      note: 'Terminal renderer' },
  { label: 'node-pty', url: 'https://github.com/microsoft/node-pty', note: 'PTY köprüsü (Microsoft)' },
  { label: 'rusqlite', url: 'https://github.com/rusqlite/rusqlite',  note: 'SQLite (WAL mode)' },
  { label: 'window-vibrancy', url: 'https://github.com/tauri-apps/window-vibrancy', note: 'Win11 Mica/Acrylic' },
];

const fonts = [
  'JetBrains Mono · Fira Code · Cascadia Code · IBM Plex Mono',
  'Source Code Pro · Inconsolata · Roboto Mono · Geist Mono',
  'Noto Sans Mono · Ubuntu Mono · Victor Mono · Space Mono',
  'Anonymous Pro · Red Hat Mono · Cousine · Courier Prime · VT323',
];

async function load() {
  if (!info.value) info.value = await api.dfetchGet();
  if (!logPaths.value) {
    try {
      logPaths.value = await api.logPaths();
    } catch {
      /* backend henüz hazır değilse */
    }
  }
}

onMounted(load);

function copyLogPath() {
  if (logPaths.value) {
    navigator.clipboard.writeText(logPaths.value.directory).catch(() => {});
  }
}

void props.open;
</script>

<template>
  <dialog v-if="open" class="dialog" open @click.self="emit('close')">
    <article class="panel">
      <header class="panel__header">
        <pre class="panel__logo">██████╗       ████████╗
██╔══██╗      ╚══██╔══╝
██║  ██║██████╗  ██║
██║  ██║╚═════╝  ██║
██████╔╝         ██║
╚═════╝          ╚═╝</pre>
        <div class="panel__title">
          <h2>D-Terminal</h2>
          <p class="ver">v{{ version }} · alpha</p>
          <p class="tagline">{{ t('app.tagline') }}</p>
        </div>
        <button type="button" class="close" @click="emit('close')">×</button>
      </header>

      <section class="section">
        <h3>{{ t('about.author') }}</h3>
        <p><strong>Orhan Engin OKAY</strong> · D Brand</p>
        <p class="muted">D-Player · DCar Launcher · D-Terminal</p>
      </section>

      <section class="section">
        <h3>{{ t('about.license') }}</h3>
        <p>MIT License — Copyright © 2026 Orhan Engin OKAY</p>
      </section>

      <section class="section">
        <h3>{{ t('about.repo') }}</h3>
        <p><a href="https://github.com/AmrasElessar/d-terminal" target="_blank" rel="noopener">github.com/AmrasElessar/d-terminal</a></p>
      </section>

      <section v-if="logPaths" class="section">
        <h3>{{ t('about.logs') }}</h3>
        <p class="mono">{{ logPaths.current_file }}</p>
        <button type="button" class="link" @click="copyLogPath">
          {{ t('about.copyLogPath') }}
        </button>
      </section>

      <section class="section">
        <h3>{{ t('about.credits') }}</h3>
        <ul class="credits">
          <li v-for="c in credits" :key="c.label">
            <a :href="c.url" target="_blank" rel="noopener"><strong>{{ c.label }}</strong></a>
            <span class="muted"> — {{ c.note }}</span>
          </li>
        </ul>
      </section>

      <section class="section">
        <h3>{{ t('about.bundledFonts') }}</h3>
        <p v-for="(line, idx) in fonts" :key="idx" class="font-line">{{ line }}</p>
      </section>
    </article>
  </dialog>
</template>

<style scoped>
.dialog {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  padding: 0;
  z-index: 100;
}
.panel {
  background: var(--color-bg);
  border: 1px solid rgba(0, 180, 216, 0.3);
  border-radius: var(--ui-radius, 2px);
  width: min(640px, 92vw);
  max-height: 88vh;
  overflow-y: auto;
  color: var(--color-fg);
  font-family: var(--font-family);
}
.panel__header {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 16px;
  align-items: start;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-line);
}
.panel__logo {
  margin: 0;
  color: var(--color-accent);
  font-size: 8px;
  line-height: 1.1;
  text-shadow: 0 0 12px rgba(0, 180, 216, 0.4);
}
.panel__title h2 {
  margin: 0 0 2px 0;
  font-size: 18px;
  background: var(--pane-title-gradient);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.ver {
  margin: 0 0 4px 0;
  font-size: 11px;
  color: var(--color-dim);
}
.tagline {
  margin: 0;
  font-size: 11px;
  opacity: 0.7;
}
.close {
  background: transparent;
  border: none;
  color: var(--color-dim);
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
  align-self: start;
}
.section {
  padding: 12px 20px;
  border-top: 1px solid var(--color-line);
}
.section:first-of-type {
  border-top: none;
}
.section h3 {
  margin: 0 0 6px 0;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-accent);
}
.section p {
  margin: 0 0 4px 0;
  font-size: 12px;
}
.section a {
  color: var(--color-accent);
  text-decoration: none;
}
.section a:hover { text-decoration: underline; }
.muted { color: var(--color-dim); }
.mono {
  font-family: var(--font-family);
  font-size: 11px;
  background: rgba(0, 0, 0, 0.3);
  padding: 4px 8px;
  border-radius: 2px;
  word-break: break-all;
}
.link {
  background: transparent;
  border: none;
  color: var(--color-accent);
  cursor: pointer;
  margin-top: 4px;
  font-size: 11px;
  padding: 0;
}
.credits {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 11px;
}
.credits li {
  margin-bottom: 3px;
}
.font-line {
  font-family: var(--font-family);
  font-size: 10px;
  color: var(--color-dim);
  margin: 2px 0;
}
</style>
