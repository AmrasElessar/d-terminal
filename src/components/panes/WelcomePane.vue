<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '@/api/tauri';
import type { SystemInfo, DiskInfo } from '@/types/events';
import { keybindings } from '@/keybindings/registry';

const { t } = useI18n();
const info = ref<SystemInfo | null>(null);
const newPaneCombo = computed(() => keybindings.getCombo('pane.new') ?? 'Ctrl+Shift+T');

// Typewriter state
const typedLogo = ref('');
const typedDfetch = ref('');
const typedHint = ref('');
const showCursor = ref(true);
const showColors = ref(false);

let cursorTimer: number | undefined;
let typeTimers: number[] = [];

const LOGO = `       ████████╗
       ╚══██╔══╝
██████╗   ██║
╚═════╝   ██║
██████╗   ██║
╚═════╝   ╚═╝`;

// Logo + dfetch satırlarını yan yana koymak için ASCII solda, info sağda 2-kolon birleşir.
const LOGO_LINES = LOGO.split('\n');
const LOGO_WIDTH = Math.max(...LOGO_LINES.map((l) => [...l].length));

function fmtBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let val = n;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function fmtPct(used: number, total: number): string {
  if (!total) return '';
  return `(${Math.round((used / total) * 100)}%)`;
}

function fmtUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

function fmtBoot(unix: number): string {
  if (!unix) return '—';
  const d = new Date(unix * 1000);
  return d.toLocaleString();
}

function fmtMhz(): string {
  // sysinfo cpu_freq atlandı (refresh kosa olabilir); kullanılmıyor
  return '';
}

function fmtDisk(d: DiskInfo): string {
  const usage = fmtPct(d.used, d.total);
  return `${d.mount_point} ${fmtBytes(d.used)} / ${fmtBytes(d.total)} ${usage} [${d.fs_type}]`;
}

interface Row { key: string; value: string; }

function buildRows(i: SystemInfo): Row[] {
  const rows: Row[] = [];
  // Header (user@host) — neofetch ilk satırında bunu render eder
  const user = (typeof navigator !== 'undefined' && navigator.userAgent) ? '' : '';
  void user;

  rows.push({ key: 'OS',         value: i.os });
  rows.push({ key: 'Host',       value: i.hostname });
  rows.push({ key: 'Kernel',     value: i.kernel });
  rows.push({ key: 'Uptime',     value: fmtUptime(i.uptime_secs) });
  rows.push({ key: 'Boot',       value: fmtBoot(i.boot_time_unix) });
  if (i.shell) rows.push({ key: 'Shell',      value: i.shell });
  rows.push({ key: 'Terminal',   value: i.terminal });
  rows.push({ key: 'Desktop',    value: i.desktop });
  rows.push({ key: 'Theme',      value: i.theme });
  if (i.screen) {
    rows.push({
      key: 'Resolution',
      value: `${i.screen.width}x${i.screen.height} @ ${i.screen.scale.toFixed(2)}x`,
    });
  }
  rows.push({ key: 'CPU',        value: `${i.cpu} ×${i.cores}${fmtMhz()}` });
  for (const g of i.gpus) {
    const vram = g.vram ? `, ${fmtBytes(g.vram)}` : '';
    rows.push({ key: 'GPU',      value: `${g.name}${vram}` });
  }
  rows.push({
    key: 'Memory',
    value: `${fmtBytes(i.ram_used)} / ${fmtBytes(i.ram_total)} ${fmtPct(i.ram_used, i.ram_total)}`,
  });
  if (i.swap_total > 0) {
    rows.push({
      key: 'Swap',
      value: `${fmtBytes(i.swap_used)} / ${fmtBytes(i.swap_total)} ${fmtPct(i.swap_used, i.swap_total)}`,
    });
  }
  for (const d of i.disks.slice(0, 4)) {
    rows.push({ key: 'Disk', value: fmtDisk(d) });
  }
  if (i.battery) {
    const ico = i.battery.full ? '⚡' : i.battery.charging ? '↑' : '↓';
    rows.push({ key: 'Battery', value: `${i.battery.percent}% ${ico}` });
  }
  rows.push({ key: 'Locale',     value: i.locale });
  rows.push({ key: 'Timezone',   value: i.timezone });
  rows.push({ key: 'Version',    value: `D-Terminal v${i.d_terminal_version}` });
  return rows;
}

function buildDfetch(i: SystemInfo): string {
  const rows = buildRows(i);
  const userHost = `${i.hostname}`;
  const sep = '─'.repeat(Math.max(8, userHost.length));
  const lines: string[] = [];
  lines.push(userHost);
  lines.push(sep);
  for (const row of rows) {
    lines.push(`${row.key.padEnd(11, ' ')} ${row.value}`);
  }
  return lines.join('\n');
}

/** Logo + info'yu yan yana 2-kolon halinde birleştir. */
function buildSideBySide(i: SystemInfo): string {
  const right = buildDfetch(i).split('\n');
  const lineCount = Math.max(LOGO_LINES.length, right.length);
  const out: string[] = [];
  for (let idx = 0; idx < lineCount; idx++) {
    const left = (LOGO_LINES[idx] ?? '').padEnd(LOGO_WIDTH, ' ');
    const r = right[idx] ?? '';
    out.push(`${left}    ${r}`);
  }
  return out.join('\n');
}

function typeInto(target: { value: string }, text: string, charDelay: number, startDelay: number): Promise<void> {
  return new Promise((resolve) => {
    target.value = '';
    let i = 0;
    const start = window.setTimeout(() => {
      const tick = () => {
        if (i >= text.length) {
          resolve();
          return;
        }
        target.value += text[i++];
        const id = window.setTimeout(tick, charDelay);
        typeTimers.push(id);
      };
      tick();
    }, startDelay);
    typeTimers.push(start);
  });
}

function clearTimers() {
  typeTimers.forEach((id) => window.clearTimeout(id));
  typeTimers = [];
}

async function refresh() {
  info.value = await api.dfetchGet();
}

async function play() {
  clearTimers();
  showColors.value = false;
  await typeInto(typedLogo, LOGO, 4, 0);
  if (info.value) {
    await typeInto(typedDfetch, buildDfetch(info.value), 2, 100);
  }
  showColors.value = true;
  const hint = `› ${t('welcome.openFirstPane', { shortcut: newPaneCombo.value })}`;
  await typeInto(typedHint, hint, 12, 200);
}

onMounted(async () => {
  cursorTimer = window.setInterval(() => {
    showCursor.value = !showCursor.value;
  }, 500);
  await refresh();
  await play();
});

watch(info, (next) => {
  if (next) play();
});

onBeforeUnmount(() => {
  if (cursorTimer) window.clearInterval(cursorTimer);
  clearTimers();
});

const cursor = computed(() => (showCursor.value ? '▋' : ' '));
const isTypingLogo = computed(() => typedLogo.value.length < LOGO.length);
const isTypingDfetch = computed(
  () => info.value && typedDfetch.value.length < buildDfetch(info.value).length,
);
const isTypingHint = computed(() => {
  const target = `› ${t('welcome.openFirstPane', { shortcut: newPaneCombo.value })}`;
  return typedHint.value.length < target.length;
});

// Logo + dfetch yan yana — typewriter sonrası 2-kolon birleşik render için tek pre kullanabilirdik
// ama her iki blok bağımsız typewriter için ayrı kalmalı. UI'da CSS grid ile yan yana koyacağız.

// Color blocks — neofetch standart: 2 satır × 8 sütun (16 ANSI rengi)
const COLOR_ROW_TOP    = [0, 1, 2, 3, 4, 5, 6, 7];
const COLOR_ROW_BOTTOM = [8, 9, 10, 11, 12, 13, 14, 15];

void buildSideBySide; // exported for potential alt mode
</script>

<template>
  <div class="welcome">
    <div class="welcome__grid">
      <pre class="welcome__logo">{{ typedLogo }}<span v-if="isTypingLogo" class="cursor">{{ cursor }}</span></pre>
      <pre v-if="info" class="welcome__info">{{ typedDfetch }}<span v-if="isTypingDfetch" class="cursor">{{ cursor }}</span></pre>
    </div>

    <!-- Neofetch-tarzı 16 ANSI color block satırı -->
    <div v-if="showColors" class="welcome__colors">
      <div class="color-row">
        <span v-for="c in COLOR_ROW_TOP" :key="`t${c}`" class="color-block" :class="`ansi-${c}`" />
      </div>
      <div class="color-row">
        <span v-for="c in COLOR_ROW_BOTTOM" :key="`b${c}`" class="color-block" :class="`ansi-${c}`" />
      </div>
    </div>

    <p class="welcome__hint">
      <span class="prompt">{{ typedHint }}</span><span v-if="isTypingHint" class="cursor">{{ cursor }}</span>
    </p>
  </div>
</template>

<style scoped>
.welcome {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: 16px 24px;
  gap: 10px;
  min-width: 0;
  overflow-y: auto;
  font-family: var(--font-family);
  background: transparent;
}
.welcome__grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 24px;
  align-items: flex-start;
}
.welcome__logo {
  margin: 0;
  color: var(--color-accent);
  font-size: 11px;
  line-height: 1.1;
  font-family: var(--font-family);
  text-shadow: 0 0 12px rgba(0, 180, 216, 0.4);
  white-space: pre;
  min-height: 6em;
}
.welcome__info {
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
  color: var(--color-fg);
  font-family: var(--font-family);
  white-space: pre;
  min-height: 14em;
}
.welcome__colors {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.color-row {
  display: flex;
}
.color-block {
  width: 22px;
  height: 14px;
  display: inline-block;
}
/* xterm.js standart 16 ANSI rengi — tema değişkenlerinden çek (D-Dark/Light/Matrix uyumlu) */
.ansi-0  { background: var(--ansi-black,    #1d1f21); }
.ansi-1  { background: var(--ansi-red,      #cc6666); }
.ansi-2  { background: var(--ansi-green,    #b5bd68); }
.ansi-3  { background: var(--ansi-yellow,   #f0c674); }
.ansi-4  { background: var(--ansi-blue,     #81a2be); }
.ansi-5  { background: var(--ansi-magenta,  #b294bb); }
.ansi-6  { background: var(--ansi-cyan,     #8abeb7); }
.ansi-7  { background: var(--ansi-white,    #c5c8c6); }
.ansi-8  { background: var(--ansi-brBlack,  #969896); }
.ansi-9  { background: var(--ansi-brRed,    #de935f); }
.ansi-10 { background: var(--ansi-brGreen,  #cc6666); }
.ansi-11 { background: var(--ansi-brYellow, #ffd75f); }
.ansi-12 { background: var(--ansi-brBlue,   #5fafff); }
.ansi-13 { background: var(--ansi-brMagenta,#d787d7); }
.ansi-14 { background: var(--ansi-brCyan,   #87d7ff); }
.ansi-15 { background: var(--ansi-brWhite,  #ffffff); }

.welcome__hint {
  margin: 4px 0 0 0;
  font-size: 11px;
  color: var(--color-dim);
}
.prompt {
  color: var(--color-accent);
}
.cursor {
  color: var(--color-accent);
  margin-left: 2px;
  animation: glow 1.2s ease-in-out infinite;
}
@keyframes glow {
  0%, 100% { opacity: 1; text-shadow: 0 0 4px var(--color-accent); }
  50%      { opacity: 0.6; text-shadow: 0 0 8px var(--color-accent); }
}
</style>
