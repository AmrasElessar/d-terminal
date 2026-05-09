<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '@/api/tauri';
import type { SystemInfo } from '@/types/events';
import { useDialogA11y } from '@/composables/useDialogA11y';
import { APP_VERSION } from '@/version';
import { SPONSORS, type SponsorTier } from '@/data/sponsors';

const TIER_ORDER: Record<SponsorTier, number> = { hero: 0, patron: 1, backer: 2, coffee: 3 };
const sortedSponsors = computed(() =>
  [...SPONSORS].sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]),
);

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const dialogEl = ref<HTMLElement | null>(null);
useDialogA11y(dialogEl, () => props.open, { onEscape: () => emit('close') });

const { t } = useI18n();
const info = ref<SystemInfo | null>(null);
const logPaths = ref<{ directory: string; current_file: string } | null>(null);
/** Footer copyright yılı — manuel update gerektirmesin diye dinamik. */
const currentYear = new Date().getFullYear();

// Backend Cargo.toml sürümü canonical kabul edilir; backend'den gelmiyorsa
// frontend package.json'daki APP_VERSION fallback (yeni sürüm bumped ama
// dfetch henüz çağrılmadı senaryosu).
const version = computed(() => info.value?.d_terminal_version ?? APP_VERSION);

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
  <dialog
    v-if="open"
    ref="dialogEl"
    class="dialog"
    open
    role="dialog"
    aria-modal="true"
    :aria-label="t('about.title')"
    @click.self="emit('close')"
  >
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
        <p class="muted">{{ t('about.platformAndroid') }}: D-Car Launcher · D-Player · D-Watchtower</p>
        <p class="muted">{{ t('about.platformWindows') }}: D-Terminal · AdminPDFToolkit</p>
      </section>

      <section class="section">
        <h3>{{ t('about.license') }}</h3>
        <p>MIT License — Copyright © {{ currentYear }} Orhan Engin OKAY</p>
      </section>

      <section class="section">
        <h3>{{ t('about.repo') }}</h3>
        <p><a href="https://github.com/AmrasElessar/d-terminal" target="_blank" rel="noopener">github.com/AmrasElessar/d-terminal</a></p>
      </section>

      <section class="section sponsor">
        <h3>{{ t('about.sponsor') }}</h3>
        <p class="muted">{{ t('about.sponsorHint') }}</p>
        <a
          class="sponsor-btn"
          href="https://github.com/sponsors/AmrasElessar"
          target="_blank"
          rel="noopener"
        >
          ♥ {{ t('about.sponsorButton') }}
        </a>

        <div class="sponsor-list">
          <h4 class="sponsor-list__title">{{ t('about.sponsorListTitle') }}</h4>
          <p v-if="sortedSponsors.length === 0" class="muted small-note">
            {{ t('about.sponsorListEmpty') }}
          </p>
          <ul v-else class="sponsor-list__items">
            <li v-for="s in sortedSponsors" :key="s.name" :class="`sponsor-item sponsor-item--${s.tier}`">
              <a v-if="s.url" :href="s.url" target="_blank" rel="noopener">{{ s.name }}</a>
              <span v-else>{{ s.name }}</span>
              <span class="sponsor-tier">{{ t(`about.tier.${s.tier}`) }}</span>
            </li>
          </ul>
        </div>
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
  background: var(--color-overlay-dark);
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  padding: 0;
  z-index: 100;
}
.panel {
  background: var(--color-bg);
  border: 1px solid var(--color-accent-glow);
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
  text-shadow: 0 0 12px var(--color-accent-glow);
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
  background: var(--color-overlay-faint);
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
.sponsor-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding: 6px 14px;
  background: linear-gradient(90deg, color-mix(in srgb, #db61a2 80%, transparent), color-mix(in srgb, #b04fff 80%, transparent));
  color: #fff !important;
  text-decoration: none !important;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  transition: filter 0.12s ease, transform 0.12s ease;
}
.sponsor-btn:hover {
  filter: brightness(1.15);
  transform: translateY(-1px);
}
.sponsor-list {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px dashed var(--color-line);
}
.sponsor-list__title {
  margin: 0 0 6px 0;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-dim);
}
.small-note { font-size: 11px; }
.sponsor-list__items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
}
.sponsor-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sponsor-item a {
  color: var(--color-fg);
}
.sponsor-tier {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 1px 6px;
  border-radius: 2px;
  border: 1px solid var(--color-line);
  color: var(--color-dim);
}
.sponsor-item--hero   .sponsor-tier { color: #f4c542; border-color: #f4c542; }
.sponsor-item--patron .sponsor-tier { color: #b04fff; border-color: #b04fff; }
.sponsor-item--backer .sponsor-tier { color: #db61a2; border-color: #db61a2; }
.sponsor-item--coffee .sponsor-tier { color: var(--color-accent); border-color: var(--color-accent); }
</style>
