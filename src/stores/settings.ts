// Kullanıcı ayarları — SQLite settings tablosuyla senkron.

import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { api } from '@/api/tauri';

export type StartupMode = 'welcome' | 'lastSession' | 'empty';
/** xterm.js render backend. `auto` → WebGL dene, başarısızsa canvas, o da olmazsa DOM. */
export type RendererMode = 'auto' | 'webgl' | 'canvas' | 'dom';

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
  scrollback: 5000,
  suppressConsoles: true,
};

const KEY_PREFIX = 'ui.';

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
            const parsed = JSON.parse(raw);
            // null guard — JSON.parse('null') geçerli ama runtime'da Object.entries
            // gibi yerlerde patlar. Default'u koru.
            if (parsed !== null) {
              (state.value as Record<string, unknown>)[k] = parsed;
            }
          } catch {
            // bozuk değer — defaults kalır
          }
        }
      }
    } finally {
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
  watch(
    () => state.value.suppressConsoles,
    async (next) => {
      if (!loaded.value) return;
      try {
        await api.processSetSuppressConsoles(next);
      } catch (e) {
        // Jail call fail — settings yine kayıt edilir; sonraki app start'ta
        // boot'ta okunup uygulanır.
        console.warn('processSetSuppressConsoles failed:', e);
      }
    },
  );

  const isReady = computed(() => loaded.value);

  return { state, isReady, load, persist };
});
