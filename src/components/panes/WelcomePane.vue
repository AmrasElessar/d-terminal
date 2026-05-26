<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '@/api/tauri';
import type { SystemInfo, DiskInfo, NetIface, LiveStats, BatteryInfo } from '@/types/events';
import { keybindings } from '@/keybindings/registry';
import { useToastsStore } from '@/stores/toasts';
import { useSettingsStore } from '@/stores/settings';
import { useThemeStore } from '@/stores/theme';
import MatrixRain from '@/components/ui/MatrixRain.vue';

const { t } = useI18n();
const info = ref<SystemInfo | null>(null);
/** Canlı stats — 1.5sn poll. CPU%, RAM (güncel), network throughput, battery. */
const live = ref<LiveStats | null>(null);
let livePollTimer: number | undefined;
const toasts = useToastsStore();
const settings = useSettingsStore();
const themeStore = useThemeStore();
const welcomeRef = ref<HTMLElement | null>(null);
/** Snapshot için kart alanı — buton/hint dışarıda, simetrik padding'li bg
 *  ile kendi başına paylaşılabilir görüntü oluşur. */
const captureRef = ref<HTMLElement | null>(null);
const newPaneCombo = computed(() => keybindings.getCombo('pane.new') ?? 'Ctrl+Shift+T');

// Typewriter (logo + hint) state
const typedLogo = ref('');
const typedHint = ref('');
const showCursor = ref(true);
const showColors = ref(false);
const visibleRowCount = ref(0); // info satırları line-by-line reveal
/** Reveal animasyonu bitti mi — bittikten sonra dinamik olarak satır eklendiğinde
 *  (network expand toggle gibi) animasyon yeniden çalmaz, yeni satırlar
 *  doğrudan gösterilir. Aksi halde slice(0, OLD_count) yeni satırları kırpardı. */
const fullyRevealed = ref(false);

/** D-Matrix temasında satır reveal'i sırasında kısa süreli scramble (Matrix
 *  yağmuru benzeri katakana glyph cycle). row.id → geçici glyph string;
 *  scramble bitince entry silinir, gerçek `row.value` görünür. Diğer
 *  temalarda bu Map boş kalır, davranış değişmez. */
const scrambleByRowId = reactive<Record<string, string>>({});

/** D-Matrix tema kontrolü — template'te v-if ve script'te koşullu mantık. */
const isMatrixTheme = computed(() => themeStore.activeName === 'D-Matrix');

/** Matrix code rain yoğunluğu (0..1). Intro'da 1.0 (sadece yağmur),
 *  satırlar gelmeye başlayınca 0.18'e düşer (atmosferik arka plan).
 *  Diğer temalarda canvas v-if ile mount edilmez. */
const rainIntensity = ref(1.0);

/** Matrix intro: önce sadece yağmur (1500ms), sonra yağmur arka plana solar +
 *  satır reveal başlar. Diğer temalarda direkt typewriter akışı.
 *  Setting'lerden tema değişirse satırlar zaten görünür durumda — yeni intro
 *  yalnızca pane fresh mount edildiğinde çalar. */
const MATRIX_INTRO_MS = 1500;
const MATRIX_FADE_MS = 600;

/** Matrix tema scramble glyph seti — yarım-genişlik katakana + sayı, klasik
 *  "Matrix Reloaded" terminal estetiği. */
const MATRIX_GLYPHS =
  'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789';

function randMatrixChar(): string {
  return MATRIX_GLYPHS[Math.floor(Math.random() * MATRIX_GLYPHS.length)] ?? '·';
}
function scrambleStr(len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) out += randMatrixChar();
  return out;
}

/** Template'in her hücresinin gösterim değeri — scramble aktifse onu, değilse
 *  gerçek `row.value`'yu döner. */
function getDisplayValue(row: Row): string {
  const s = scrambleByRowId[row.id];
  return s !== undefined ? s : row.value;
}

let cursorTimer: number | undefined;
let typeTimers: number[] = [];

const LOGO = `██████╗       ████████╗
██╔══██╗      ╚══██╔══╝
██║  ██║██████╗  ██║
██║  ██║╚═════╝  ██║
██████╔╝         ██║
╚═════╝          ╚═╝`;

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

/** MAC: AA:BB:CC:DD:EE:FF → AA:BB:••:••:••:FF (üreticı OUI ön ek + son oktet). */
function maskMac(mac: string): string {
  const parts = mac.split(':');
  if (parts.length !== 6) return '•'.repeat(mac.length);
  return `${parts[0]}:${parts[1]}:••:••:••:${parts[5]}`;
}

interface Row {
  id: string;
  key: string;
  value: string;
  sensitive?: boolean;
  /** Maskeli halinin string'i — sensitive ise kullanılır. */
  masked?: string;
  /** Network "Others (N)" toggle row'u — özel davranış: tıklayınca expand. */
  isNetExpander?: boolean;
  /** Network expander'ın gösterdiği gizli iface sayısı. */
  netHiddenCount?: number;
  /** Renkli yüzde rozeti (Memory/Swap/Disk/Battery/CPU). 0-100. */
  pct?: number;
}

/** % değerine göre renk sınıfı — yeşil/sarı/kırmızı geçiş.
 *  Battery için ters mantık (low = kırmızı) — `invert: true` ile çağrılır. */
function pctClass(pct: number, invert = false): string {
  const v = invert ? 100 - pct : pct;
  if (v < 60) return 'pct--good';
  if (v < 85) return 'pct--warn';
  return 'pct--bad';
}

/** "Other interfaces" katlanmış mı (network bölümü için). */
const netExpanded = ref(false);
function toggleNetExpand() { netExpanded.value = !netExpanded.value; }

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

function pctOf(used: number, total: number): number | undefined {
  if (!total) return undefined;
  return Math.round((used / total) * 100);
}

/** Live stats'tan throughput formatı: 12 KB/s. 1024'e bölünmez bazlarda
 *  kullanıcı için anlamlı kalsın diye `fmtBytes` ile aynı kademe. */
function fmtBps(n: number): string {
  if (!n || n < 1) return '0 B/s';
  return `${fmtBytes(n)}/s`;
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
  // % rozeti ayrı bir span'da render edilir (renkli) — burada metin sadece
  // boyutlar + dosya sistemi.
  return `${d.mount_point} ${fmtBytes(d.used)} / ${fmtBytes(d.total)} [${d.fs_type}]`;
}

function fmtIface(n: NetIface): string {
  const macPart = n.mac ? ` · ${n.mac}` : '';
  return `${n.name}: ${n.ip}${macPart}`;
}

function maskedIface(n: NetIface): string {
  const ipMasked = n.family === 'v4' ? maskIPv4(n.ip) : maskIPv6(n.ip);
  const macPart = n.mac ? ` · ${maskMac(n.mac)}` : '';
  return `${n.name}: ${ipMasked}${macPart}`;
}

function buildRows(i: SystemInfo): Row[] {
  const rows: Row[] = [];
  rows.push({ id: 'os', key: t('dfetch.os'), value: i.os });
  rows.push({
    id: 'host',
    key: t('dfetch.host'),
    value: i.hostname,
    sensitive: true,
    masked: maskHost(i.hostname),
  });
  rows.push({ id: 'kernel', key: t('dfetch.kernel'), value: i.kernel });
  rows.push({ id: 'uptime', key: t('dfetch.uptime'), value: fmtUptime(i.uptime_secs) });
  rows.push({ id: 'boot', key: t('dfetch.boot'), value: fmtBoot(i.boot_time_unix) });
  if (i.shell) rows.push({ id: 'shell', key: t('dfetch.shell'), value: i.shell });
  rows.push({ id: 'terminal', key: t('dfetch.terminal'), value: i.terminal });
  rows.push({ id: 'desktop', key: t('dfetch.desktop'), value: i.desktop });
  rows.push({ id: 'theme', key: t('dfetch.theme'), value: i.theme });
  if (i.screen) {
    rows.push({
      id: 'res',
      key: t('dfetch.resolution'),
      value: `${i.screen.width}x${i.screen.height} @ ${i.screen.scale.toFixed(2)}x`,
    });
  }
  // CPU: brand + topology + canlı yüzde.
  // Topology: hybrid (Intel 12th+) ise "8P+4E (12C/20T)", normal ise "8C/16T".
  const cpuPct = live.value ? Math.round(live.value.cpu_percent) : undefined;
  let topology: string;
  if (i.cpu_hybrid) {
    topology = `${i.cpu_hybrid.p_cores}P+${i.cpu_hybrid.e_cores}E (${i.cores}C/${i.logical_cores}T)`;
  } else if (i.cores > 0 && i.logical_cores > i.cores) {
    topology = `${i.cores}C/${i.logical_cores}T`;
  } else if (i.cores > 0) {
    topology = `${i.cores}C`;
  } else {
    topology = `${i.logical_cores}T`;
  }
  rows.push({
    id: 'cpu',
    key: t('dfetch.cpu'),
    value: `${i.cpu} · ${topology}`,
    pct: cpuPct,
  });
  for (let g = 0; g < i.gpus.length; g++) {
    const gpu = i.gpus[g]!;
    const vram = gpu.vram ? `, ${fmtBytes(gpu.vram)}` : '';
    rows.push({ id: `gpu-${g}`, key: t('dfetch.gpu'), value: `${gpu.name}${vram}` });
  }
  // RAM: live varsa onun kullanılan değerini al (dfetch_get'ten zaman geçti).
  const ramUsed = live.value?.ram_used ?? i.ram_used;
  const ramTotal = live.value?.ram_total ?? i.ram_total;
  rows.push({
    id: 'mem',
    key: t('dfetch.ram'),
    value: `${fmtBytes(ramUsed)} / ${fmtBytes(ramTotal)}`,
    pct: pctOf(ramUsed, ramTotal),
  });
  if (i.swap_total > 0) {
    rows.push({
      id: 'swap',
      key: t('dfetch.swap'),
      value: `${fmtBytes(i.swap_used)} / ${fmtBytes(i.swap_total)}`,
      pct: pctOf(i.swap_used, i.swap_total),
    });
  }
  for (let d = 0; d < Math.min(4, i.disks.length); d++) {
    const disk = i.disks[d]!;
    rows.push({
      id: `disk-${d}`,
      key: t('dfetch.disk'),
      value: fmtDisk(disk),
      pct: pctOf(disk.used, disk.total),
    });
  }
  // Network: primary interface(ler) her zaman görünür, diğerleri toggle.
  // Primary = sistemin internete çıkışta kullandığı (default route source).
  // Eğer hiçbiri primary değilse ilk v4'ü primary kabul et (çoğu kullanım için).
  if (i.local_ips.length > 0) {
    let primaries = i.local_ips.filter((n) => n.is_primary);
    if (primaries.length === 0) {
      const firstV4 = i.local_ips.find((n) => n.family === 'v4');
      if (firstV4) primaries = [firstV4];
    }
    const others = i.local_ips.filter((n) => !primaries.includes(n));

    for (const iface of primaries) {
      const idx = i.local_ips.indexOf(iface);
      rows.push({
        id: `net-${idx}`,
        key: iface.family === 'v4' ? t('dfetch.ipv4') : t('dfetch.ipv6'),
        value: fmtIface(iface),
        sensitive: true,
        masked: maskedIface(iface),
      });
    }
    // Live throughput — primary interface adıyla eşleşen sysinfo kaydını ara.
    // Trafik yokken bile satır kalsın (gizleme), `—` ile göster.
    if (live.value && primaries.length > 0) {
      const primaryNames = new Set(primaries.map((p) => p.name));
      const tput = live.value.net.find((n) => primaryNames.has(n.name));
      const rxText = tput && tput.rx_bps > 0 ? fmtBps(tput.rx_bps) : '—';
      const txText = tput && tput.tx_bps > 0 ? fmtBps(tput.tx_bps) : '—';
      rows.push({
        id: 'net-throughput',
        key: t('dfetch.netIo'),
        value: `↓ ${rxText}  ↑ ${txText}`,
      });
    }
    if (others.length > 0) {
      // Aç/kapa row — tıklayınca diğerlerini reveal eder. Detay row'lar
      // ardından gelir, expanded false ise atılır.
      rows.push({
        id: 'net-expander',
        key: t('dfetch.net'),
        value: '',
        isNetExpander: true,
        netHiddenCount: others.length,
      });
      if (netExpanded.value) {
        for (const iface of others) {
          const idx = i.local_ips.indexOf(iface);
          rows.push({
            id: `net-${idx}`,
            key: iface.family === 'v4' ? t('dfetch.ipv4') : t('dfetch.ipv6'),
            value: fmtIface(iface),
            sensitive: true,
            masked: maskedIface(iface),
          });
        }
      }
    }
  }
  // Battery: live'dan al (taze yüzde + kalan süre), yoksa info'dan.
  const battery: BatteryInfo | null = live.value?.battery ?? i.battery;
  if (battery) {
    const ico = battery.full ? '⚡' : battery.charging ? '↑' : '↓';
    let val = `${battery.percent}% ${ico}`;
    if (!battery.charging && !battery.full && battery.time_remaining_min) {
      const h = Math.floor(battery.time_remaining_min / 60);
      const m = battery.time_remaining_min % 60;
      val += h > 0 ? `  ~${h}h ${m}m` : `  ~${m}m`;
    }
    rows.push({
      id: 'bat',
      key: t('dfetch.battery'),
      value: val,
      // Pil için renk ters: %20 = kırmızı, %80 = yeşil. Şarj olurken renk yok.
      pct: battery.charging || battery.full ? undefined : battery.percent,
    });
  }
  rows.push({ id: 'locale', key: t('dfetch.locale'), value: i.locale });
  rows.push({ id: 'tz', key: t('dfetch.timezone'), value: i.timezone });
  rows.push({ id: 'ver', key: t('dfetch.version'), value: `D-Terminal v${i.d_terminal_version}` });
  return rows;
}

const allRows = computed<Row[]>(() => (info.value ? buildRows(info.value) : []));
const visibleRows = computed<Row[]>(() =>
  fullyRevealed.value ? allRows.value : allRows.value.slice(0, visibleRowCount.value),
);

/** Tüm satırların ortak `key` kolon genişliği — `padEnd` bütçesi.
 *  Her `.row` ayrı bir CSS grid olduğundan `auto` key kolonu satıra göre
 *  boyutlanır; tek tip padding olmadan TR'de "Çalışma süresi" (14ch) ile
 *  EN'de "OS" (2ch) farklı key kolon genişliklerine yol açar → value
 *  sütunu satırlar arası kayar. Tüm anahtarları en uzun anahtara göre
 *  padle ki her satırın key kolonu aynı genişlikte olsun. */
const maxKeyLen = computed(() => {
  let m = 8;
  for (const r of allRows.value) {
    if (r.key && r.key.length > m) m = r.key.length;
  }
  return m;
});

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

/** Info satırlarını sırayla reveal (typewriter benzeri ama line-by-line).
 *  D-Matrix temasında her satır için kısa süreli scramble effect:
 *  Matrix yağmurundaki gibi rastgele katakana glyph'leri ~250ms boyunca
 *  yanıp söner, sonra gerçek değer ortaya çıkar. */
function revealRowsAnimated(): Promise<void> {
  return new Promise((resolve) => {
    visibleRowCount.value = 0;
    fullyRevealed.value = false;
    const total = allRows.value.length;
    if (total === 0) {
      fullyRevealed.value = true;
      resolve();
      return;
    }
    const isMatrix = themeStore.activeName === 'D-Matrix';
    const SCRAMBLE_TICK_MS = 30;
    const SCRAMBLE_DURATION_MS = 250;

    let n = 0;
    const tick = () => {
      n += 1;
      visibleRowCount.value = n;
      // Yeni reveal edilen satır için scramble başlat (Matrix temada).
      if (isMatrix) {
        const row = allRows.value[n - 1];
        if (row && row.value && row.value.length > 0) {
          startScramble(row.id, row.value.length, SCRAMBLE_DURATION_MS, SCRAMBLE_TICK_MS);
        }
      }
      if (n >= total) {
        fullyRevealed.value = true;
        // Final satır scramble bitince resolve — ekran kararlı görünsün.
        const finalDelay = isMatrix ? SCRAMBLE_DURATION_MS + SCRAMBLE_TICK_MS : 0;
        const id = window.setTimeout(resolve, finalDelay);
        typeTimers.push(id);
        return;
      }
      const id = window.setTimeout(tick, 35);
      typeTimers.push(id);
    };
    const start = window.setTimeout(tick, 100);
    typeTimers.push(start);
  });
}

/** Tek satır için scramble cycle: targetLen kadar random glyph string
 *  durationMs boyunca tickMs aralıklarla yenilenir, bitince entry silinir. */
function startScramble(rowId: string, targetLen: number, durationMs: number, tickMs: number) {
  scrambleByRowId[rowId] = scrambleStr(targetLen);
  const startedAt = performance.now();
  const cycle = () => {
    const elapsed = performance.now() - startedAt;
    if (elapsed >= durationMs) {
      delete scrambleByRowId[rowId];
      return;
    }
    scrambleByRowId[rowId] = scrambleStr(targetLen);
    const id = window.setTimeout(cycle, tickMs);
    typeTimers.push(id);
  };
  const id = window.setTimeout(cycle, tickMs);
  typeTimers.push(id);
}

function clearTimers() {
  typeTimers.forEach((id) => window.clearTimeout(id));
  typeTimers = [];
}

async function refresh() {
  info.value = await api.dfetchGet();
}

async function pollLive() {
  try {
    live.value = await api.dfetchLive();
  } catch {
    /* sessiz — bir tick atlayabiliriz */
  }
}

function startLivePolling() {
  if (livePollTimer !== undefined) return;
  const interval = settings.state.dfetchPollIntervalMs;
  // 0 = polling kapalı (kullanıcı statik snapshot ister, batarya tasarrufu vb).
  if (interval <= 0) return;
  // Çok düşük değerler (<300ms) hem CPU yer hem WMI battery latency'sini iter.
  // 500ms altına izin verme.
  const safeInterval = Math.max(500, interval);
  // İlk tick hemen — sysinfo Networks ilk refresh'te delta üretmez (baseline),
  // ikinci tick'ten itibaren throughput dolar.
  void pollLive();
  livePollTimer = window.setInterval(pollLive, safeInterval);
}
function stopLivePolling() {
  if (livePollTimer !== undefined) {
    window.clearInterval(livePollTimer);
    livePollTimer = undefined;
  }
}
// Settings'ten poll aralığı değişirse interval'ı yeniden başlat (canlı reaktif).
watch(
  () => settings.state.dfetchPollIntervalMs,
  () => {
    stopLivePolling();
    startLivePolling();
  },
);

/** Welcome panel'in PNG snapshot'ını oluşturup kullanıcının seçtiği yere yazdır.
 *  Sadece `.welcome__capture` alanı (logo + info + renk blokları) yakalanır;
 *  snapshot butonu ve "open first pane" hint'i dışarıda kalır.
 *  Tauri save dialog → path → custom Rust komutu ile dosyaya bytes yaz. */
async function takeSnapshot() {
  const target = captureRef.value;
  if (!target) return;

  // 1. PNG'yi yakala — kart stillerini canlı DOM'a EKLEMEden, html-to-image'in
  //    iç clone'una `style` opsiyonu ile geçir. Kullanıcı orijinal DOM'da
  //    hiçbir görsel değişiklik görmez; çıkan PNG yine kart formunda.
  //    BAYRAK ANİMASYONU: çekim anlık donmalı, yamuk logo'lu PNG çıkmasın.
  //    `--freeze-logo` class'ı animation+transform'u sıfırlar; clone'a da
  //    miras kaldığından PNG dik logo ile çıkar.
  let dataUrl: string;
  target.classList.add('welcome__capture--freeze-logo');
  // Stil resetinin layer compositor'a yansıması için bir frame bekle.
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  try {
    const { toPng } = await import('html-to-image');
    const cs = getComputedStyle(target);
    const bg = cs.getPropertyValue('--color-bg').trim() || '#0A0E1A';
    const fg = cs.getPropertyValue('--color-fg').trim() || '#E2E8F0';
    dataUrl = await toPng(target, {
      pixelRatio: 2,
      backgroundColor: bg,
      cacheBust: true,
      style: {
        padding: '18px 20px',
        background: bg,
        border: `1px solid color-mix(in srgb, ${fg} 8%, transparent)`,
        borderRadius: '8px',
        gap: '12px',
        // Render kartını içerik genişliğine sıkıştır (PNG fazla beyaz alan içermesin)
        width: 'max-content',
        maxWidth: 'max-content',
      },
    });
  } catch (e) {
    target.classList.remove('welcome__capture--freeze-logo');
    toasts.error(t('welcome.snapshotFailed', { error: String(e) }));
    return;
  }
  // Animasyon hemen geri açılsın — yakalama bitti.
  target.classList.remove('welcome__capture--freeze-logo');

  // 2. Çerçeveyi dolanan ışık — yalnızca canlı DOM'da, PNG'de yok.
  //    Animasyon bitince save dialog açılır.
  target.classList.add('welcome__capture--flash');
  await new Promise<void>((resolve) => {
    const onEnd = () => {
      target.removeEventListener('animationend', onEnd);
      target.classList.remove('welcome__capture--flash');
      resolve();
    };
    target.addEventListener('animationend', onEnd, { once: true });
    window.setTimeout(onEnd, 1500); // fail-safe
  });

  // 2. Yer seç + dosyaya yaz. Bu noktada DOM zaten orijinal halinde.
  try {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const targetPath = await save({
      title: t('welcome.snapshotHint'),
      defaultPath: `dfetch-${ts}.png`,
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    });
    if (!targetPath) return; // kullanıcı iptal

    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    const bin = atob(base64);
    const bytes = new Array<number>(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    await api.dfetchSaveSnapshot(targetPath, bytes);
    toasts.success(t('welcome.snapshotSavedAt', { path: targetPath }), 4000);
  } catch (e) {
    toasts.error(t('welcome.snapshotFailed', { error: String(e) }));
  }
}

/** play() reentrancy guard — `info` watcher ve `onMounted` aynı anda
 *  tetiklediğinde iki paralel play() çalışmasını engeller. İkinci çağrı
 *  birincinin Matrix intro setTimeout'unu clearTimers ile öldürünce birinci
 *  sonsuz await'te asılırdı. Şimdi tek seferde tek play akar. */
let playToken = 0;
async function play() {
  const myToken = ++playToken;
  clearTimers();
  showColors.value = false;
  // Yeni oturum/refresh — reveal state sıfırla (KVKK güvenli default)
  for (const k of Object.keys(revealed)) delete revealed[k];

  // D-Matrix intro: 1500ms boyunca SADECE yağmur akar, logo ve satırlar gizli;
  // sonra yağmur 0.18 atmosfere solar + logo typewriter başlar. Diğer
  // temalarda intro yok, normal akış.
  if (isMatrixTheme.value) {
    rainIntensity.value = 1.0;
    typedLogo.value = '';
    await new Promise((r) => {
      const id = window.setTimeout(r, MATRIX_INTRO_MS);
      typeTimers.push(id);
    });
    if (myToken !== playToken) return; // başka play başladı, eskisini abort et
    // Yağmur arka plana çekilirken logo typewriter başlar (paralel).
    rainIntensity.value = 0.18;
  } else {
    rainIntensity.value = 0; // garantilemek için (diğer temalarda canvas v-if zaten)
  }

  await typeInto(typedLogo, LOGO, 4, 0);
  if (myToken !== playToken) return;
  await revealRowsAnimated();
  if (myToken !== playToken) return;
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
  // Reveal animasyonu bittikten sonra canlı stats'ı başlat — dfetch_get'in
  // ağır olan kısımlarına ek olarak hafif refresh, panel açıkken sürekli akar.
  startLivePolling();
  // Welcome pane mount edildiğinde snapshot + network toggle kısayolları
  // aktif. Çoklu welcome açıksa son mount overwrite eder (rare case).
  keybindings.register('dfetch.snapshot', () => takeSnapshot());
  keybindings.register('dfetch.toggleNetExpand', () => toggleNetExpand());
});

// Tema değişince intro'yu yeniden çal — kullanıcı default→Matrix yaptığında
// rain canvas mount olur ama prop'taki intensity stale (0) kalmamasın diye
// fresh play() ile rainIntensity=1.0'dan akış yeniden başlasın.
watch(isMatrixTheme, () => {
  if (info.value) play();
});

onBeforeUnmount(() => {
  if (cursorTimer) window.clearInterval(cursorTimer);
  clearTimers();
  stopLivePolling();
  keybindings.unregister('dfetch.snapshot');
  keybindings.unregister('dfetch.toggleNetExpand');
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
  <div ref="welcomeRef" class="welcome" :class="{ 'welcome--matrix': isMatrixTheme }">
    <!-- D-Matrix temasında klasik "code rain" overlay — intro'da tam yoğunluk,
         satırlar gelmeye başlayınca atmosferik arka plana solar.
         Diğer temalarda v-if ile mount edilmez (canvas ve rAF loop'u yok). -->
    <MatrixRain v-if="isMatrixTheme" :intensity="rainIntensity" />
    <button
      type="button"
      class="welcome__snap"
      :title="t('welcome.snapshotHint')"
      :aria-label="t('welcome.snapshotHint')"
      @click="takeSnapshot"
    >
📸
</button>
    <!-- Snapshot kartı — sadece bu alan yakalanır (buton ve hint dışarıda). -->
    <div ref="captureRef" class="welcome__capture">
      <div class="welcome__grid">
      <!-- Sol kolon: D-T brand logosu üstte, Windows OS logosu altta.
           Bu layout 3-kolon yatay yerine 2-kolon dikey istif — info kolonuna
           ~22 char ekstra yer kazandırır, dar pencerelerde wrap'siz çalışır. -->
      <div class="welcome__logos">
        <pre class="welcome__logo">{{ typedLogo }}<span v-if="isTypingLogo" class="cursor">{{ cursor }}</span></pre>

        <!-- Windows OS logo — fastfetch/neofetch klasik wavy versiyon.
             Microsoft brand colors (4 quadrant). Her satır kendi animation
             gecikmesi ile yatayda sinus dalgası yapar (bayrak efekti). -->
        <div v-if="info && showColors" class="os-logo" aria-hidden="true">
          <div
            v-for="(line, i) in WIN_LOGO_LINES"
            :key="i"
            class="os-logo__line"
            :style="{ animationDelay: `${i * 110}ms` }"
          >
<span :class="i < 7 ? 'win-red' : 'win-blue'">{{ line.left }}</span><span :class="i < 7 ? 'win-green' : 'win-yellow'">{{ line.right }}</span>
</div>
        </div>
      </div>

      <div v-if="info" class="welcome__info">
        <template v-for="row in visibleRows" :key="row.id">
          <button
            v-if="row.isNetExpander"
            type="button"
            class="row row--expander"
            :class="{ open: netExpanded }"
            :title="t('welcome.netExpandHint')"
            @click="toggleNetExpand"
          >
            <span class="row__key">{{ row.key.padEnd(maxKeyLen, ' ') }}</span>
            <span class="row__value row__value--expander">
              <span class="chev">{{ netExpanded ? '▾' : '▸' }}</span>
              {{ netExpanded
                ? t('welcome.netHideOthers')
                : t('welcome.netShowOthers', { count: row.netHiddenCount }) }}
            </span>
          </button>
          <div v-else class="row" :class="{ 'row--scramble': scrambleByRowId[row.id] !== undefined }">
            <span class="row__key">{{ row.key.padEnd(maxKeyLen, ' ') }}</span>
            <span class="row__value">
              {{ row.sensitive && !isRevealed(row.id) ? row.masked : getDisplayValue(row) }}
              <span
                v-if="row.pct !== undefined"
                class="pct"
                :class="pctClass(row.pct, row.id === 'bat')"
              >({{ row.pct }}%)</span>
            </span>
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
        </template>
      </div>
    </div>

      <!-- Neofetch-tarzı 16 ANSI color block satırı (capture kartı içinde) -->
      <div v-if="showColors" class="welcome__colors">
        <div class="color-row">
          <span v-for="c in COLOR_ROW_TOP" :key="`t${c}`" class="color-block" :class="`ansi-${c}`" />
        </div>
        <div class="color-row">
          <span v-for="c in COLOR_ROW_BOTTOM" :key="`b${c}`" class="color-block" :class="`ansi-${c}`" />
        </div>
      </div>
    </div><!-- /welcome__capture -->

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
  position: relative;
}
/* Snapshot kartı — normalde görünmez, html-to-image yakalama anında
   `--snapping` modifier sınıfı eklenir, kart stilleri o zaman aktif olur. */
.welcome__capture {
  display: flex;
  flex-direction: column;
  gap: 10px;
  position: relative;
  /* MatrixRain canvas z-index: 0; içeriği üzerine getir ki yağmur arkada
     kalsın, satırlar/logo okunabilir olsun. */
  z-index: 1;
}
/* D-Matrix temasında welcome wrapper'ı koyu siyah arka plan ister — code
   rain canvas'ın alt katmanında siyah dolgu. Mica/transparent vibrancy bile
   olsa yağmur etkisi için solid backdrop olmalı. */
.welcome--matrix {
  background: rgba(0, 8, 0, 0.92);
}
.welcome--matrix .welcome__snap {
  z-index: 2;
}
.welcome__capture--snapping {
  gap: 12px;
  padding: 18px 20px;
  background: var(--color-bg);
  border: 1px solid color-mix(in srgb, var(--color-fg) 8%, transparent);
  border-radius: 8px;
  /* Self-fit width: kart paylaşılırken içerik kadar genişlikte. */
  max-width: max-content;
}
/* Kamera flaşı — çerçeveyi dolaşan ışık (border-trace). Yakalama bittikten
   sonra tetiklenir, PNG'ye dahil değildir. Tema accent rengi conic-gradient
   ile döner, mask-composite trick'i sayesinde yalnızca kenar şeridinde
   görünür → sanki ışık çerçevenin etrafında geziyormuş gibi.
   Edge 111+ (Tauri WebView2) @property + mask-composite destekler. */
@property --dt-light-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}
.welcome__capture--flash {
  border-radius: 8px;
  width: max-content;
  max-width: 100%;
}
.welcome__capture--flash::after {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 10px;
  padding: 2px;
  pointer-events: none;
  background: conic-gradient(
    from var(--dt-light-angle),
    transparent 0deg,
    transparent 280deg,
    color-mix(in srgb, var(--color-accent) 40%, transparent) 310deg,
    color-mix(in srgb, var(--color-accent) 100%, white)      350deg,
    color-mix(in srgb, var(--color-accent) 40%, transparent) 30deg,
    transparent 60deg,
    transparent 360deg
  );
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
          mask-composite: exclude;
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--color-accent) 70%, transparent));
  animation: dtBorderLight 1200ms linear forwards;
}
@keyframes dtBorderLight {
  0%   { --dt-light-angle:   0deg; }
  100% { --dt-light-angle: 360deg; }
}
/* Sağ üstte snapshot butonu — fetch panelinin görüntüsünü PNG olarak indir. */
.welcome__snap {
  position: absolute;
  top: 8px;
  right: 12px;
  background: color-mix(in srgb, var(--color-fg) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-fg) 12%, transparent);
  color: var(--color-fg);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 4px 7px;
  border-radius: 4px;
  opacity: 0.6;
  transition: opacity 0.15s ease, border-color 0.15s ease, background 0.15s ease;
  z-index: 5;
}
.welcome__snap:hover {
  opacity: 1;
  background: color-mix(in srgb, var(--color-accent) 18%, transparent);
  border-color: var(--color-accent);
}
/* Renkli yüzde rozeti — yeşil/sarı/kırmızı kademe.
   Battery için ters çağrılır (low % = kırmızı). */
.pct {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  margin-left: 6px;
}
.pct--good { color: color-mix(in srgb, var(--color-green)   85%, var(--color-fg)); }
.pct--warn { color: color-mix(in srgb, var(--color-yellow)  90%, var(--color-fg)); }
.pct--bad  { color: color-mix(in srgb, var(--color-red)     90%, var(--color-fg)); }
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
   Her satır kendi gecikmesi ile yatayda sinus dalgası yapar — bayrak
   gibi yumuşak akış. translateX-only animasyon GPU compositor'da kalır,
   reflow tetiklemez. */
.os-logo {
  margin: 0;
  font-family: var(--font-family);
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0;
  animation: os-fade 0.6s ease-out;
  text-shadow: 0 0 6px var(--color-overlay-faint);
  /* Animasyon transform değişikliği yapıyor; subpixel render katmanı oluştur */
  will-change: contents;
}
.os-logo__line {
  display: block;
  white-space: pre;
  animation: os-logo-wave 3.2s ease-in-out infinite;
  /* Sol kenara sabitle, sağ kenar daha çok hareket etsin (bayrak direği
     solda, kumaş kuyruğu sağda flap). */
  transform-origin: left center;
}
/* Bayrak rüzgar dalgası — çapraz tepe yukarı→aşağı geziyor.
   translateX (yatay esme) + skewX (kumaş tilt) + translateY (mikro ripple).
   Hepsi compositor-friendly transform. */
@keyframes os-logo-wave {
  0%   { transform: translate( 3px, -0.5px) skewX(-2deg); }
  25%  { transform: translate( 0px,  0.5px) skewX( 0deg); }
  50%  { transform: translate(-3px,  0.5px) skewX( 2deg); }
  75%  { transform: translate( 0px, -0.5px) skewX( 0deg); }
  100% { transform: translate( 3px, -0.5px) skewX(-2deg); }
}
/* Erişilebilirlik: kullanıcı azaltılmış hareket istediyse sallanma kapanır. */
@media (prefers-reduced-motion: reduce) {
  .os-logo__line { animation: none; }
}
/* Snapshot anında bayrak donsun — yamuk logo'lu PNG paylaşılmasın. */
.welcome__capture--freeze-logo .os-logo__line {
  animation: none !important;
  transform: none !important;
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
  text-shadow: 0 0 12px var(--color-accent-glow);
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
/* D-Matrix scramble effect — satır reveal anında glyph yağmuru görünürken
   yeşil glow + hafif text-shadow ile "Matrix Reloaded" terminal estetiği.
   Scramble bittiğinde class kalkar, gerçek değer normal renge döner. */
.row--scramble .row__value {
  color: var(--color-green);
  text-shadow:
    0 0 4px color-mix(in srgb, var(--color-green) 60%, transparent),
    0 0 12px color-mix(in srgb, var(--color-green) 30%, transparent);
  letter-spacing: 0.05em;
}
/* Network "Other interfaces (N)" expander — button olarak render edilir
   ama görsel olarak satır gibi durur. Tema-uyumlu. */
.row--expander {
  background: transparent;
  border: none;
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
  text-align: left;
  width: 100%;
  padding: 0 2px;
  color: inherit;
}
.row--expander .row__value--expander {
  color: color-mix(in srgb, var(--color-cyan) 75%, var(--color-fg));
  font-style: italic;
  opacity: 0.85;
}
.row--expander:hover .row__value--expander { opacity: 1; }
.row--expander .chev {
  display: inline-block;
  width: 1em;
  color: var(--color-accent);
  font-style: normal;
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
  position: relative;
  z-index: 1;
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
