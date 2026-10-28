// Kullanıcı ayarları — SQLite settings tablosuyla senkron.

import { defineStore } from 'pinia';
import { computed, nextTick, ref, watch } from 'vue';
import { api } from '@/api/tauri';

export type StartupMode = 'welcome' | 'lastSession' | 'empty';
/** xterm.js render backend. `auto` → WebGL dene, başarısızsa canvas, o da olmazsa DOM. */
export type RendererMode = 'auto' | 'webgl' | 'canvas' | 'dom';
/** Updater check sıklığı. `startup` = her uygulama açılışında check (debounce yok).
 *  Diğerleri lastCheckAt'i baz alan minimum interval. */
export type UpdateCheckFrequency = 'startup' | '1h' | '6h' | '12h' | '24h';
/** Pane/tab kapatma onay davranışı.
 *  - `never`: Hiç sorma (eski davranış).
 *  - `runningOnly`: Sadece aktif PTY varsa sor (önerilen).
 *  - `always`: Her zaman sor (welcome/exit edilmiş dahil).
 *  Shift basılıysa her durumda bypass — "ne yaptığımı biliyorum" çıkışı. */
export type ConfirmOnCloseMode = 'never' | 'runningOnly' | 'always';

export interface SettingsState {
  /** ISO dil kodu (`tr`, `en`, `de`, `pt-BR`, ...). Topluluk bir dil paketi
   *  eklediğinde `src/locales/<kod>.json` bırakması yeterli — kod değişmez. */
  language: string;
  themeName: string;
  fontFamily: string;
  fontSize: number;
  ligatures: boolean;
  opacity: number;
  blur: number;
  startup: StartupMode;
  renderer: RendererMode;
  /** Unicode 11 width tablosunu kullan — emoji + CJK genişliği daha doğru. */
  unicode11: boolean;
  /** Boş prompt'ta `#` tuşuna basıldığında AI komut üretici açılsın mı (Warp paritesi). */
  aiPrefixHash: boolean;
  /** Pencere arka plan malzemesi.
   *  - auto: Win11 22H2+ ise Mica, yoksa hiçbiri (Acrylic resize'da FPS düşürür).
   *  - mica: zorla Mica (Win11 22H2+ gerekir).
   *  - acrylic: blur efekti, resize'da yavaşlayabilir.
   *  - none: opak — en hızlı, modern arayüz görünümü kapanır. */
  windowVibrancy: 'auto' | 'mica' | 'acrylic' | 'none';
  /** Klavye kısayolu override'ları — id → combo. Boş ise default kullanılır. */
  shortcutOverrides: Record<string, string>;
  /** History tabanlı inline öneri (fish/Warp tarzı) — boş prompt'ta yazarken
   *  geçmişten en son eşleşen komut gri renkte gösterilir; → veya Tab ile kabul. */
  inlineAutocomplete: boolean;
  /** xterm screen reader modu — ekran okuyucu (NVDA/Narrator) için aria-live
   *  bölge açar, çıktıyı sırayla okutur. Performans maliyeti var, default kapalı. */
  screenReaderMode: boolean;
  /** Tmux-style prefix key — açıkken `prefixCombo`'ya basınca 1 sn'lik modal
   *  moda gir, sonraki harf tuşu (V/H/Z/X/C/N/P/T) action tetikler. */
  prefixModeEnabled: boolean;
  prefixCombo: string;
  /** Custom AI provider'ın OpenAI-uyumlu endpoint'i (örn. https://openrouter.ai/api/v1).
   *  Boş ise custom provider devre dışı sayılır. */
  aiCustomEndpoint: string;
  /** Welcome pane canlı stat polling aralığı (ms). CPU%, RAM, ağ throughput
   *  bu sıklıkta yenilenir. 0 = polling kapalı (statik snapshot). 500-10000 ideal. */
  dfetchPollIntervalMs: number;
  /** AI agent (OSC 9999 start event veya heuristic detector) tetiklendiğinde
   *  otomatik olarak yan pane aç (agentView). Mac terminal benzeri çoklu-agent
   *  görünümü; default off — opt-in çünkü bazı kullanıcılar split istemez. */
  autoSplitOnAgent: boolean;
  /** Otomatik güncelleme davranışı.
   *  - notify: yeni sürüm var → toast bildir, kullanıcı manuel başlatır.
   *  - download-wait: arka planda indir → bittiğinde "kapatınca yüklensin?" sor.
   *  - auto: indir + quit'te otomatik kur (sormadan).
   *  - off: hiç check etme. */
  updateMode: 'off' | 'notify' | 'download-wait' | 'auto';
  /** Updater check sıklığı — `startup` her uygulama açılışında, diğerleri minimum
   *  interval (lastCheckAt baz alır). v0.9.x serisi sık release çıkardığı için
   *  default 'startup' — kullanıcı bildirimi kaçırmasın; isteyen 24h'a alabilir. */
  updateCheckFrequency: UpdateCheckFrequency;
  /** Windows boot'unda D-Terminal otomatik başlasın mı (HKCU\...\Run).
   *  Backend tauri-plugin-autostart ile registry yazımı yapar; UI sadece
   *  state'i tutar ve watch ile plugin enable/disable çağırır. */
  autoStartOnBoot: boolean;
  /** xterm scrollback satır sayısı. Pane başına ~80 char × 2 byte (UTF-16)
   *  bellek tüketir; 5000 satır ≈ 800 KB/pane. Default 5000 — modern terminal
   *  pratiği (önceki 10000 çok pane'li kullanımda 16+ MB/pencere). */
  scrollback: number;
  /** Child process console window suppression. D-Terminal'in spawn ettiği
   *  ardışık komutlar (sidecar, git_stat'ın `git`, vs.) Windows'ta default
   *  olarak yeni conhost.exe açar → ekranda DOS pencere flash'ları.
   *  Default true (suppress); geliştirici external GUI tool spawn etmek
   *  isterse false yapabilir. Backend ProcessJail.set_suppress_consoles
   *  ile runtime'da uygulanır — uygulama yeniden başlatma gerekmez. */
  suppressConsoles: boolean;
  /** Pane/tab kapatma onay davranışı. Default `runningOnly` — aktif çalışan PTY
   *  varken yanlışlıkla kapanma kazasını önler. Shift basılıyken bypass. */
  confirmOnClose: ConfirmOnCloseMode;
  /** AI agent heuristic detector (Claude Code/Codex paralel batch parser vb.)
   *  aktif mi. False ise sadece OSC 9999 formal protokolü dispatch eder
   *  (yanlış pozitiflerden kaçınmak isteyen kullanıcılar için). Default true. */
  agentHeuristicEnabled: boolean;
}

const DEFAULTS: SettingsState = {
  language: 'tr',
  themeName: 'D-Dark',
  fontFamily: 'JetBrains Mono',
  fontSize: 12,
  ligatures: true,
  opacity: 0.92,
  blur: 8,
  startup: 'welcome',
  renderer: 'auto',
  unicode11: true,
  aiPrefixHash: true,
  windowVibrancy: 'auto',
  shortcutOverrides: {},
  inlineAutocomplete: true,
  screenReaderMode: false,
  prefixModeEnabled: false,
  prefixCombo: 'Ctrl+B',
  aiCustomEndpoint: '',
  dfetchPollIntervalMs: 1500,
  autoSplitOnAgent: false,
  updateMode: 'notify',
  updateCheckFrequency: 'startup',
  autoStartOnBoot: false,
  scrollback: 5000,
  suppressConsoles: true,
  confirmOnClose: 'runningOnly',
  agentHeuristicEnabled: true,
};

const KEY_PREFIX = 'ui.';

/** Enum alanları için izinli değerler — DB'den gelen bozuk/eski değer
 *  (ör. elle düzenlenmiş config) default'a düşer. */
const ENUMS: Partial<Record<keyof SettingsState, readonly string[]>> = {
  startup: ['welcome', 'lastSession', 'empty'],
  renderer: ['auto', 'webgl', 'canvas', 'dom'],
  windowVibrancy: ['auto', 'mica', 'acrylic', 'none'],
  updateMode: ['off', 'notify', 'download-wait', 'auto'],
  updateCheckFrequency: ['startup', '1h', '6h', '12h', '24h'],
  confirmOnClose: ['never', 'runningOnly', 'always'],
};
/** Sayısal alanların geçerli aralığı. */
const RANGES: Partial<Record<keyof SettingsState, [number, number]>> = {
  fontSize: [6, 72],
  opacity: [0, 1],
  blur: [0, 100],
  dfetchPollIntervalMs: [0, 60_000],
  scrollback: [0, 100_000],
};

/** Persist edilmiş (güvenilmez) değeri doğrula; geçersizse undefined. */
export function sanitizeSetting<K extends keyof SettingsState>(
  key: K,
  value: unknown,
): SettingsState[K] | undefined {
  const def = DEFAULTS[key];
  if (value === null || value === undefined) return undefined;
  if (typeof def === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    const r = RANGES[key];
    return (r ? Math.min(r[1], Math.max(r[0], value)) : value) as SettingsState[K];
  }
  if (typeof def === 'boolean') return typeof value === 'boolean' ? (value as SettingsState[K]) : undefined;
  if (typeof def === 'string') {
    if (typeof value !== 'string') return undefined;
    const allowed = ENUMS[key];
    if (allowed && !allowed.includes(value)) return undefined;
    return value as SettingsState[K];
  }
  if (typeof def === 'object') {
    if (typeof value !== 'object' || Array.isArray(value)) return undefined;
    // shortcutOverrides: Record<string, string>
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out as SettingsState[K];
  }
  return undefined;
}

export const useSettingsStore = defineStore('settings', () => {
  const state = ref<SettingsState>({ ...DEFAULTS });
  const loaded = ref(false);

  async function load() {
    try {
      const all = await api.settingsAll();
      for (const k of Object.keys(state.value) as Array<keyof SettingsState>) {
        const raw = all[`${KEY_PREFIX}${k}`];
        if (raw !== undefined) {
          try {
            const valid = sanitizeSetting(k, JSON.parse(raw));
            if (valid !== undefined) {
              (state.value as Record<string, unknown>)[k] = valid;
            }
          } catch {
            // bozuk değer — defaults kalır
          }
        }
      }
    } finally {
      // Yükleme sırasında tetiklenen auto-persist watcher'ları `loaded=false`
      // iken çalışsın (az önce okunan değerleri geri yazmasın) — sonra aç.
      await nextTick();
      loaded.value = true;
    }
  }

  async function persist<K extends keyof SettingsState>(key: K, value: SettingsState[K]) {
    state.value[key] = value;
    await api.settingsSet(`${KEY_PREFIX}${String(key)}`, JSON.stringify(value));
  }

  // Auto-persist: per-field watch — daha önce tek deep-watch her değişiklikte
  // 26 field × 2 (next + prev) = 52 JSON.stringify çağırıyordu (Frontend perf
  // K2). Şimdi her field kendi watcher'ı ile bağımsız serialize ediliyor;
  // diğer field'lar etkilenmiyor. Paralel persist için (5 ayar değişirse 5
  // sıralı IPC yerine paralel) Promise tutmuyoruz — her watcher zaten
  // bağımsız async kontrolü.
  function attachAutoPersist() {
    const keys = Object.keys(DEFAULTS) as Array<keyof SettingsState>;
    for (const k of keys) {
      watch(
        () => state.value[k],
        async (next) => {
          if (!loaded.value) return;
          await api.settingsSet(`${KEY_PREFIX}${String(k)}`, JSON.stringify(next));
        },
        { deep: true },
      );
    }
  }
  attachAutoPersist();

  // ProcessJail runtime sync — suppressConsoles toggle'ı backend jail'a anında
  // uygulanır (yeniden başlatma yok). settings_set persist watch'undan ayrı,
  // jail process_set_suppress_consoles command'ı ayrıca çağırılır.
  //
  // Race senaryosu: backend invoke fail olursa state rollback edilir, böylece
  // DB'de "false" ama backend "true" tutarsızlığı oluşmaz. UI değer flip eder
  // → generic persist watch yeni değeri DB'ye yazar (re-sync). Toast yok,
  // sessiz rollback (kullanıcı checkbox'ın geri döndüğünü görür).
  let syncing = false;
  watch(
    () => state.value.suppressConsoles,
    async (next, prev) => {
      if (!loaded.value) return;
      if (syncing) return; // rollback sırasında tekrar tetiklenmesin
      try {
        await api.processSetSuppressConsoles(next);
      } catch (e) {
        console.warn('processSetSuppressConsoles failed, rolling back:', e);
        syncing = true;
        state.value.suppressConsoles = prev as boolean;
        // microtask sonrası flag'i temizle — generic persist watch eski değeri
        // tekrar DB'ye yazsın, sonraki manuel toggle çalışsın.
        Promise.resolve().then(() => { syncing = false; });
      }
    },
  );

  const isReady = computed(() => loaded.value);

  return { state, isReady, load, persist };
});
