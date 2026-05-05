<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '@/api/tauri';
import type { SystemInfo, DiskInfo, NetIface } from '@/types/events';
import { keybindings } from '@/keybindings/registry';

const { t } = useI18n();
const info = ref<SystemInfo | null>(null);
const newPaneCombo = computed(() => keybindings.getCombo('pane.new') ?? 'Ctrl+Shift+T');

// Typewriter (logo + hint) state
const typedLogo = ref('');
const typedHint = ref('');
const showCursor = ref(true);
const showColors = ref(false);
const visibleRowCount = ref(0); // info satırları line-by-line reveal

let cursorTimer: number | undefined;
let typeTimers: number[] = [];

const LOGO = `██████╗      ████████╗
██╔══██╗     ╚══██╔══╝
██║  ██║━━━     ██║
██║  ██║        ██║
██████╔╝        ██║
╚═════╝         ╚═╝`;

const LOGO_LINES = LOGO.split('\n');

// --- KVKK/GDPR maskeleme ---
//
// Hassas alanlar (hostname, IP, MAC, kullanıcı adı) varsayılan olarak
// maskelenir. Yanlarındaki 👁 butonuna tıklayınca kullanıcı kendi
// sorumluluğunda açar/kapar. Reveal state OTURUM IÇIN yaşar — yeni pane
// açılışında her şey yeniden maskeli (KVKK güvenli default).

const revealed = reactive<Record<string, boolean>>({});

function isRevealed(rowId: string): boolean {
  return !!revealed[rowId];
}
function toggleReveal(rowId: string) {
  revealed[rowId] = !revealed[rowId];
}

function maskHost(s: string): string {
  if (!s) return '';
  if (s.length <= 3) return '•'.repeat(s.length);
  return s.slice(0, 2) + '•'.repeat(Math.max(3, s.length - 2));
}
function maskIPv4(ip: string): string {
  // 192.168.1.42 → 192.168.•.•
  const parts = ip.split('.');
  if (parts.length !== 4) return '•'.repeat(ip.length);
  return `${parts[0]}.${parts[1]}.•.•`;
}
function maskIPv6(ip: string): string {
  // fe80::a1b2:c3d4:... → fe80::•:•:•:•
  if (!ip.includes(':')) return '•'.repeat(ip.length);
  const head = ip.split(':').slice(0, 2).join(':');
  return `${head}::•:•:•:•`;
}

interface Row {
  id: string;
  key: string;
  value: string;
  sensitive?: boolean;
  /** Maskeli halinin string'i — sensitive ise kullanılır. */
  masked?: string;
}

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

function fmtDisk(d: DiskInfo): string {
  const usage = fmtPct(d.used, d.total);
  return `${d.mount_point} ${fmtBytes(d.used)} / ${fmtBytes(d.total)} ${usage} [${d.fs_type}]`;
}

function fmtIface(n: NetIface): string {
  return `${n.name}: ${n.ip}`;
}

function maskedIface(n: NetIface): string {
  return `${n.name}: ${n.family === 'v4' ? maskIPv4(n.ip) : maskIPv6(n.ip)}`;
}

function buildRows(i: SystemInfo): Row[] {
  const rows: Row[] = [];
  rows.push({ id: 'os', key: 'OS', value: i.os });
  rows.push({
    id: 'host',
    key: 'Host',
    value: i.hostname,
    sensitive: true,
    masked: maskHost(i.hostname),
  });
  rows.push({ id: 'kernel', key: 'Kernel', value: i.kernel });
  rows.push({ id: 'uptime', key: 'Uptime', value: fmtUptime(i.uptime_secs) });
  rows.push({ id: 'boot', key: 'Boot', value: fmtBoot(i.boot_time_unix) });
  if (i.shell) rows.push({ id: 'shell', key: 'Shell', value: i.shell });
  rows.push({ id: 'terminal', key: 'Terminal', value: i.terminal });
  rows.push({ id: 'desktop', key: 'Desktop', value: i.desktop });
  rows.push({ id: 'theme', key: 'Theme', value: i.theme });
  if (i.screen) {
    rows.push({
      id: 'res',
      key: 'Resolution',
      value: `${i.screen.width}x${i.screen.height} @ ${i.screen.scale.toFixed(2)}x`,
    });
  }
  rows.push({ id: 'cpu', key: 'CPU', value: `${i.cpu} ×${i.cores}` });
  for (let g = 0; g < i.gpus.length; g++) {
    const gpu = i.gpus[g]!;
    const vram = gpu.vram ? `, ${fmtBytes(gpu.vram)}` : '';
    rows.push({ id: `gpu-${g}`, key: 'GPU', value: `${gpu.name}${vram}` });
  }
  rows.push({
    id: 'mem',
    key: 'Memory',
    value: `${fmtBytes(i.ram_used)} / ${fmtBytes(i.ram_total)} ${fmtPct(i.ram_used, i.ram_total)}`,
  });
  if (i.swap_total > 0) {
    rows.push({
      id: 'swap',
      key: 'Swap',
      value: `${fmtBytes(i.swap_used)} / ${fmtBytes(i.swap_total)} ${fmtPct(i.swap_used, i.swap_total)}`,
    });
  }
  for (let d = 0; d < Math.min(4, i.disks.length); d++) {
    rows.push({ id: `disk-${d}`, key: 'Disk', value: fmtDisk(i.disks[d]!) });
  }
  for (let n = 0; n < i.local_ips.length; n++) {
    const iface = i.local_ips[n]!;
    rows.push({
      id: `net-${n}`,
      key: iface.family === 'v4' ? 'IPv4' : 'IPv6',
      value: fmtIface(iface),
      sensitive: true,
      masked: maskedIface(iface),
    });
  }
  if (i.battery) {
    const ico = i.battery.full ? '⚡' : i.battery.charging ? '↑' : '↓';
    rows.push({ id: 'bat', key: 'Battery', value: `${i.battery.percent}% ${ico}` });
  }
  rows.push({ id: 'locale', key: 'Locale', value: i.locale });
  rows.push({ id: 'tz', key: 'Timezone', value: i.timezone });
  rows.push({ id: 'ver', key: 'Version', value: `D-Terminal v${i.d_terminal_version}` });
  return rows;
}

const allRows = computed<Row[]>(() => (info.value ? buildRows(info.value) : []));
const visibleRows = computed<Row[]>(() => allRows.value.slice(0, visibleRowCount.value));

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

/** Info satırlarını sırayla reveal (typewriter benzeri ama line-by-line). */
function revealRowsAnimated(): Promise<void> {
  return new Promise((resolve) => {
    visibleRowCount.value = 0;
    const total = allRows.value.length;
    if (total === 0) {
      resolve();
      return;
    }
    let n = 0;
    const tick = () => {
      n += 1;
      visibleRowCount.value = n;
      if (n >= total) {
        resolve();
        return;
      }
      const id = window.setTimeout(tick, 35);
      typeTimers.push(id);
    };
    const start = window.setTimeout(tick, 100);
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
  // Yeni oturum/refresh — reveal state sıfırla (KVKK güvenli default)
  for (const k of Object.keys(revealed)) delete revealed[k];

  await typeInto(typedLogo, LOGO, 4, 0);
  await revealRowsAnimated();
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
const isTypingHint = computed(() => {
  const target = `› ${t('welcome.openFirstPane', { shortcut: newPaneCombo.value })}`;
  return typedHint.value.length < target.length;
});

// Color blocks — neofetch standart: 2 satır × 8 sütun
const COLOR_ROW_TOP    = [0, 1, 2, 3, 4, 5, 6, 7];
const COLOR_ROW_BOTTOM = [8, 9, 10, 11, 12, 13, 14, 15];

// Klasik fastfetch/neofetch Windows logosu — wavy 4-pane.
// Her satır left (sol yarı) + right (sağ yarı) olarak ayrı renklendirilir.
// Üst 7 satır: sol kırmızı / sağ yeşil. Alt 9 satır: sol mavi / sağ sarı.
// Sınır kolonu = ~22 (sol yarının doğal kesimi).
const WIN_LOGO_RAW = [
  '        ,.=:!!t3Z3z.,',
  '       :tt:::tt333EE3',
  '       Et:::ztt33EEEL @Ee.,      ..,',
  '      ;tt:::tt333EE7 ;EEEEEEttttt33#',
  '     :Et:::zt333EEQ. $EEEEEttttt33QL',
  '     it::::tt333EEF @EEEEEEttttt33F',
  '    ;3=*^```\'*4EEV :EEEEEEttttt33@.',
  '    ,.=::::!t=., ` @EEEEEEtttz33QF',
  '   ;::::::::zt33)   \'4EEEtttji3P*',
  '  :t::::::::tt33.:Z3z..  `` ,..g.',
  '  i::::::::zt33F AEEEtttt::::ztF',
  ' ;:::::::::t33V ;EEEttttt::::t3',
  ' E::::::::zt33L @EEEtttt::::z3F',
  '{3=*^```\'*4E3) ;EEEtttt:::::tZ`',
  '             ` :EEEEtttt::::z7',
  '                 \'VEzjt:;;z>*`',
];
const WIN_LOGO_SPLIT = 22;
const WIN_LOGO_LINES = WIN_LOGO_RAW.map((line) => ({
  left: line.slice(0, WIN_LOGO_SPLIT),
  right: line.slice(WIN_LOGO_SPLIT),
}));
</script>

<template>
  <div class="welcome">
    <div class="welcome__grid">
      <!-- Sol kolon: D-T brand logosu üstte, Windows OS logosu altta.
           Bu layout 3-kolon yatay yerine 2-kolon dikey istif — info kolonuna
           ~22 char ekstra yer kazandırır, dar pencerelerde wrap'siz çalışır. -->
      <div class="welcome__logos">
        <pre class="welcome__logo">{{ typedLogo }}<span v-if="isTypingLogo" class="cursor">{{ cursor }}</span></pre>

        <!-- Windows OS logo — fastfetch/neofetch klasik wavy versiyon.
             Microsoft brand colors (4 quadrant). Stilize representation
             (fair use / descriptive), birebir Microsoft asset değil. -->
        <pre v-if="info && showColors" class="os-logo" aria-hidden="true"><template v-for="(line, i) in WIN_LOGO_LINES" :key="i"><span :class="i < 7 ? 'win-red' : 'win-blue'">{{ line.left }}</span><span :class="i < 7 ? 'win-green' : 'win-yellow'">{{ line.right }}</span>{{ '\n' }}</template></pre>
      </div>

      <div v-if="info" class="welcome__info">
        <div v-for="row in visibleRows" :key="row.id" class="row">
          <span class="row__key">{{ row.key.padEnd(11, ' ') }}</span>
          <span class="row__value">{{ row.sensitive && !isRevealed(row.id) ? row.masked : row.value }}</span>
          <button
            v-if="row.sensitive"
            type="button"
            class="row__eye"
            :class="{ active: isRevealed(row.id) }"
            :title="t('welcome.maskHint')"
            :aria-label="isRevealed(row.id) ? t('welcome.maskHide') : t('welcome.maskShow')"
            @click="toggleReveal(row.id)"
          >
            {{ isRevealed(row.id) ? '🙈' : '👁' }}
          </button>
        </div>
      </div>
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
.welcome__logos {
  display: flex;
  flex-direction: column;
  gap: 16px;
  /* D-T (~22 char) Windows logosuna (~38 char) göre yatay ortalı */
  align-items: center;
}

/* Windows OS logo — fastfetch klasik wavy, Microsoft brand renkleri.
   Tek <pre> içinde span'larla 4 quadrant renklendirilir. */
.os-logo {
  margin: 0;
  font-family: var(--font-family);
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0;
  white-space: pre;
  animation: os-fade 0.6s ease-out;
  text-shadow: 0 0 6px rgba(0, 0, 0, 0.3);
}
.win-red    { color: #F25022; }
.win-green  { color: #7FBA00; }
.win-blue   { color: #00A4EF; }
.win-yellow { color: #FFB900; }
@keyframes os-fade {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
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
  display: flex;
  flex-direction: column;
  font-size: 11px;
  line-height: 1.55;
  font-family: var(--font-family);
  min-height: 14em;
}
.row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 4px;
  align-items: center;
  padding: 0 2px;
  border-radius: 2px;
}
.row:hover { background: color-mix(in srgb, var(--color-fg) 3%, transparent); }
.row__key {
  color: var(--color-accent);
  white-space: pre;
}
.row__value {
  color: var(--color-fg);
  font-variant-numeric: tabular-nums;
}
.row__eye {
  background: transparent;
  border: none;
  color: var(--color-dim);
  cursor: pointer;
  font-size: 11px;
  padding: 0 4px;
  opacity: 0;
  transition: opacity 0.1s ease;
}
.row:hover .row__eye,
.row__eye.active {
  opacity: 0.85;
}
.row__eye:hover {
  opacity: 1;
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
