<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '@/api/tauri';
import type { SystemInfo } from '@/types/events';
import { keybindings } from '@/keybindings/registry';

const { t } = useI18n();
const info = ref<SystemInfo | null>(null);
const newPaneCombo = computed(() => keybindings.getCombo('pane.new') ?? 'Ctrl+Shift+T');

async function refresh() {
  info.value = await api.dfetchGet();
}

onMounted(refresh);

function fmtBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = n;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val.toFixed(1)} ${units[idx]}`;
}

function fmtUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return [d ? `${d}d` : '', h ? `${h}h` : '', `${m}m`].filter(Boolean).join(' ');
}
</script>

<template>
  <div class="welcome">
    <div class="welcome__hero">
      <pre class="welcome__logo">  ____      _____
 |  _ \    |_   _|
 | | | |_____| |
 | | | |_____| |
 | |_| |     | |
 |____/      |_|</pre>
      <div>
        <h1>{{ t('app.title') }}</h1>
        <p class="tagline">{{ t('app.tagline') }}</p>
        <p class="hint">
          {{ t('welcome.openFirstPane', { shortcut: newPaneCombo }) }}
        </p>
      </div>
    </div>

    <section v-if="info" class="welcome__info">
      <h2>{{ t('dfetch.title') }}</h2>
      <dl>
        <div><dt>{{ t('dfetch.os') }}</dt><dd>{{ info.os }}</dd></div>
        <div><dt>{{ t('dfetch.kernel') }}</dt><dd>{{ info.kernel }}</dd></div>
        <div><dt>{{ t('dfetch.hostname') }}</dt><dd>{{ info.hostname }}</dd></div>
        <div><dt>{{ t('dfetch.cpu') }}</dt><dd>{{ info.cpu }} ({{ t('dfetch.cores', { count: info.cores }) }})</dd></div>
        <div>
          <dt>{{ t('dfetch.ram') }}</dt>
          <dd>{{ t('dfetch.ramFormat', { used: fmtBytes(info.ram_used), total: fmtBytes(info.ram_total) }) }}</dd>
        </div>
        <div><dt>{{ t('dfetch.uptime') }}</dt><dd>{{ fmtUptime(info.uptime_secs) }}</dd></div>
        <div><dt>{{ t('dfetch.version') }}</dt><dd>v{{ info.d_terminal_version }}</dd></div>
      </dl>
      <button type="button" class="link" @click="refresh">{{ t('dfetch.refresh') }}</button>
    </section>
  </div>
</template>

<style scoped>
.welcome {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: 32px;
  min-width: 0;
  overflow-y: auto;
}
.welcome__hero {
  display: flex;
  align-items: center;
  gap: 32px;
}
.welcome__logo {
  margin: 0;
  background: var(--pane-title-gradient, linear-gradient(90deg, var(--color-accent), var(--color-accent2)));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-family: var(--font-family);
  font-size: 14px;
  line-height: 1.1;
}
h1 {
  margin: 0 0 4px 0;
  font-size: 28px;
  background: var(--pane-title-gradient, linear-gradient(90deg, var(--color-accent), var(--color-accent2)));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.tagline {
  margin: 0 0 12px 0;
  opacity: 0.7;
}
.hint {
  margin: 0;
  font-size: 13px;
  opacity: 0.6;
}
.welcome__info {
  background: rgba(255, 255, 255, 0.03);
  border-radius: var(--ui-radius, 8px);
  padding: 16px 20px;
  min-width: 320px;
  max-width: 600px;
}
.welcome__info h2 {
  margin: 0 0 12px 0;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.7;
}
dl {
  display: grid;
  grid-template-columns: 1fr;
  gap: 6px;
  margin: 0;
  font-size: 13px;
}
dl > div {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 12px;
}
dt {
  opacity: 0.6;
}
dd {
  margin: 0;
  font-family: var(--font-family);
}
.link {
  background: transparent;
  border: none;
  color: var(--color-accent);
  cursor: pointer;
  margin-top: 12px;
  font-size: 12px;
}
</style>
