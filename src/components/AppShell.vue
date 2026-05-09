<script setup lang="ts">
import { defineAsyncComponent, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePanesStore } from '@/stores/panes';
import { useSettingsStore } from '@/stores/settings';
import { useThemeStore } from '@/stores/theme';
import { useAIStore } from '@/stores/ai';
import { useSnippetsStore } from '@/stores/snippets';
import { useTriggersStore } from '@/stores/triggers';
import { useProfilesStore } from '@/stores/profiles';
import { keybindings } from '@/keybindings/registry';
import { fallbackChain, ensureFontLoaded } from '@/fonts';
import { api } from '@/api/tauri';
import { createLogger } from '@/utils/logger';
import { useModals } from '@/composables/useModals';
import PaneLayout from '@/components/layout/PaneLayout.vue';
import StatusBar from '@/components/ui/StatusBar.vue';
import ContextMenu from '@/components/ui/ContextMenu.vue';
import TabBar from '@/components/ui/TabBar.vue';
import ToastContainer from '@/components/ui/ToastContainer.vue';
import { getCurrentWindow } from '@tauri-apps/api/window';

// Modallar lazy load — v-if ile mount/destroy + dynamic import ile prod
// build'de ayrı chunk'a düşer. İlk açılışta sadece shell + layout yüklenir,
// modallar talep edildiğinde async fetch.
const NewPaneDialog   = defineAsyncComponent(() => import('@/components/ui/NewPaneDialog.vue'));
const SettingsModal   = defineAsyncComponent(() => import('@/components/ui/SettingsModal.vue'));
const HistoryModal    = defineAsyncComponent(() => import('@/components/ui/HistoryModal.vue'));
const SessionModal    = defineAsyncComponent(() => import('@/components/ui/SessionModal.vue'));
const SnippetModal    = defineAsyncComponent(() => import('@/components/ui/SnippetModal.vue'));
const CommandPalette  = defineAsyncComponent(() => import('@/components/ui/CommandPalette.vue'));
const AboutModal      = defineAsyncComponent(() => import('@/components/ui/AboutModal.vue'));
const AISuggestModal  = defineAsyncComponent(() => import('@/components/ui/AISuggestModal.vue'));
import type { PaneType } from '@/types/pane';

const { t, locale } = useI18n();
const panes = usePanesStore();
const settings = useSettingsStore();
const themeStore = useThemeStore();
const ai = useAIStore();
const snippets = useSnippetsStore();
const triggers = useTriggersStore();
const profiles = useProfilesStore();
const log = createLogger('shell');
const modals = useModals();

/** Process'in admin token'ı var mı (Windows UAC). Mount sırasında okunur,
 *  değişmez (process lifetime boyunca elevation değişmez). Header'da rozet,
 *  Settings'te "Yönetici olarak başlat" durum bilgisi için kullanılır. */
const isElevated = ref(false);

/** Aktif font + boyut'u CSS değişkenlerine yansıt — UI ile xterm aynı görünür.
 *  Lazy-load: kullanıcının seçtiği font bundle'da eager değilse arka planda
 *  fetch edilir; bu sırada fallback chain (`Noto Sans Mono`, `Cascadia`,
 *  `Consolas`, ...) devreye girer ve UI çökmez. */
function applyFontVars() {
  const root = document.documentElement;
  const family = settings.state.fontFamily;
  root.style.setProperty('--font-family', fallbackChain(family));
  root.style.setProperty('--font-size', `${settings.state.fontSize}px`);
  // fire-and-forget — yüklenince CSS otomatik etkin olur (font-face inject).
  void ensureFontLoaded(family);
}

/** Pencere arka plan opaklığı + blur — Tauri window transparent ile birlikte çalışır. */
function applyChromeVars() {
  const root = document.documentElement;
  root.style.setProperty('--bg-alpha', String(settings.state.opacity));
  root.style.setProperty('--ui-blur', `${settings.state.blur}px`);
}

/** WebView2 DevTools toggle — yalnızca dev build'de aktif.
 * Release Cargo.toml'da `tauri/devtools` feature kapalı; üretimde bu fonksiyon
 * hiçbir şey yapmaz (DevTools üzerinden frontend state/secret manipülasyonunu
 * önlemek için). Geliştirici dev modunda `cargo tauri dev` ile çalışırken erişir. */
async function toggleDevTools() {
  if (!import.meta.env.DEV) return;
  try {
    const w = await import('@tauri-apps/api/webview');
    const view = w.getCurrentWebview() as unknown as {
      openDevtools?: () => Promise<void>;
      closeDevtools?: () => Promise<void>;
    };
    if (view.openDevtools) await view.openDevtools();
  } catch (e) {
    log.warn('devtools open failed', { error: String(e) });
  }
}

function openNewPane()    { modals.open('newPane'); }
function openSettings()   { modals.open('settings'); }
function openHistory()    { modals.open('history'); }
function openSnippets()   { modals.open('snippets'); }
function openPalette()    { modals.open('commandPalette'); }

// Custom window controls — Tauri 2 frameless mode (decorations:false).
// Native title bar yok, min/max/close butonlarını biz çizip API'yi çağırıyoruz.
const windowMaximized = ref(false);
async function syncMaximized() {
  try { windowMaximized.value = await getCurrentWindow().isMaximized(); } catch (e) { console.warn('isMaximized failed', e); }
}
async function winMinimize() {
  try { await getCurrentWindow().minimize(); } catch (e) { console.warn('minimize failed', e); }
}
async function winToggleMax() {
  try { await getCurrentWindow().toggleMaximize(); await syncMaximized(); } catch (e) { console.warn('toggleMaximize failed', e); }
}
async function winClose() {
  try { await getCurrentWindow().close(); } catch (e) { console.warn('close failed', e); }
}
function openSessionSave() { modals.openSession('save'); }
function openSessionLoad() { modals.openSession('load'); }

function createPane(type: PaneType, profileId?: string) {
  // Profil verilmişse onun adıyla başlık aç, yoksa pane tipi adı
  const profile = profileId ? profiles.find(profileId) : null;
  const title = profile?.name ?? t(`pane.type.${type}`);
  panes.openPane(type, title, profileId);
  modals.close('newPane');
}

function closeFocused() {
  if (panes.tree.focusedId) panes.closePane(panes.tree.focusedId);
}

/** Split: focused pane'in tipi/profilini koru — PowerShell pane'iyse PS, SSH ise SSH. */
function splitH() {
  const f = panes.focused;
  if (f && (f.type === 'powershell' || f.type === 'cmd' || f.type === 'wsl')) {
    panes.splitFocused('horizontal', f.type, f.title, f.profileId);
  } else {
    panes.splitFocused('horizontal', 'powershell', t('pane.type.powershell'));
  }
}
function splitV() {
  const f = panes.focused;
  if (f && (f.type === 'powershell' || f.type === 'cmd' || f.type === 'wsl')) {
    panes.splitFocused('vertical', f.type, f.title, f.profileId);
  } else {
    panes.splitFocused('vertical', 'powershell', t('pane.type.powershell'));
  }
}
function openAi() {
  panes.openPane('aiChat', t('pane.type.aiChat'));
}

function paletteNavigate(action: string) {
  modals.close('commandPalette');
  switch (action) {
    case 'settings': openSettings(); break;
    case 'history': openHistory(); break;
    case 'snippets': openSnippets(); break;
    case 'session-save': openSessionSave(); break;
    case 'session-load': openSessionLoad(); break;
  }
}

/** Tmux-style prefix mode aktif et veya kapat. Settings'ten okunur, ayar
 *  değiştiğinde watch ile yeniden çağrılır. Action haritası registry'ye
 *  verilir; AppShell'de zaten register edilmiş action id'lerine map'lenir. */
function applyPrefixMode() {
  if (!settings.state.prefixModeEnabled || !settings.state.prefixCombo) {
    keybindings.setPrefix(null, {});
    return;
  }
  keybindings.setPrefix(settings.state.prefixCombo, {
    v: 'pane.splitVertical',
    h: 'pane.splitHorizontal',
    z: 'pane.maximize',
    x: 'pane.close',
    n: 'pane.focusNext',
    p: 'pane.focusPrev',
    t: 'tab.new',
    w: 'tab.close',
    s: 'session.save',
    o: 'session.load',
  });
}

onMounted(async () => {
  // Window state — frameless modda min/max butonları için
  void syncMaximized();
  try {
    await getCurrentWindow().onResized(() => syncMaximized());
  } catch { /* dev mode'da bazı listener'lar erken hata verebilir */ }

  // Settings + theme zorunlu sıralı (locale/theme uygulanmalı sonraki adımlar).
  await settings.load();
  locale.value = settings.state.language;
  await themeStore.load();
  themeStore.setActive(settings.state.themeName);
  // Geri kalan store'lar birbirinden bağımsız → paralel yükle (300-500ms kazanç).
  // Her biri kendi hatasını yutar; biri patlasa diğerleri açılır.
  await Promise.all([
    ai.refresh().catch(() => {}),
    snippets.load().catch(() => {}),
    triggers.load().catch(() => {}),
    profiles.load().catch(() => {}),
    panes.startListening().catch(() => {}),
  ]);
  // UAC elevation durumu — process lifetime boyunca sabit, tek seferlik fetch
  api.adminIsElevated().then((v) => { isElevated.value = v; }).catch(() => {});

  if (settings.state.startup === 'welcome') {
    panes.openPane('welcome', t('pane.type.welcome'));
  }

  keybindings.register('pane.new', openNewPane);
  keybindings.register('pane.close', closeFocused);
  keybindings.register('pane.splitHorizontal', splitH);
  keybindings.register('pane.splitVertical', splitV);
  keybindings.register('pane.focusNext', () => panes.focusNext());
  keybindings.register('pane.focusPrev', () => panes.focusPrev());
  keybindings.register('ai.openPane', openAi);
  keybindings.register('settings.open', openSettings);
  keybindings.register('history.search', openHistory);
  keybindings.register('commandPalette.open', openPalette);
  keybindings.register('session.save', openSessionSave);
  keybindings.register('session.load', openSessionLoad);
  keybindings.register('dfetch.run', () => panes.openPane('welcome', t('pane.type.welcome')));
  if (import.meta.env.DEV) keybindings.register('app.devTools', toggleDevTools);
  // Tab kısayolları (browser standardı)
  keybindings.register('tab.new',   () => panes.newTab());
  keybindings.register('tab.close', () => panes.closeTab(panes.activeTabId));
  keybindings.register('tab.next',  () => panes.nextTab());
  keybindings.register('tab.prev',  () => panes.prevTab());
  // About + broadcast input
  keybindings.register('app.about', () => modals.open('about'));
  keybindings.register('panes.broadcastToggle', () => panes.toggleBroadcast());
  keybindings.register('pane.maximize', () => panes.toggleMaximize());
  keybindings.register('ai.suggestCommand', () => modals.open('aiSuggest'));
  // Pane font zoom (per-pane, base settings.fontSize üstüne offset)
  keybindings.register('pane.zoomIn',    () => panes.adjustFocusedFontSize(+1));
  keybindings.register('pane.zoomOut',   () => panes.adjustFocusedFontSize(-1));
  keybindings.register('pane.zoomReset', () => panes.resetFocusedFontSize());

  // Prefix mode (tmux tarzı modal kısayollar) — ayardan açılır, kapalıysa
  // setPrefix(null, ...) çağrısı listener'da hiçbir etki yapmaz.
  applyPrefixMode();

  // Kullanıcı override'larını uygula (Settings → Kısayollar'dan değiştirilir).
  // Defensive: HMR/eski SQLite'ta key yoksa undefined gelebilir.
  const overrides = settings.state.shortcutOverrides ?? {};
  for (const [id, combo] of Object.entries(overrides)) {
    if (combo) keybindings.setCombo(id, combo);
  }
  keybindings.attach();

  applyFontVars();
  applyChromeVars();
  // İlk açılışta kullanıcının seçtiği vibrancy'i uygula (lib.rs'in default'unu override)
  api.windowSetVibrancy(settings.state.windowVibrancy).catch((e) => {
    log.warn('window vibrancy apply failed', { error: String(e) });
  });
  log.info('shell ready', { panes: panes.paneCount, theme: themeStore.activeName });

  // Updater check (lazy import — yalnız ihtiyaç olunca yüklenir, startup'a yük binmez)
  void import('@/composables/useUpdater').then(({ autoCheckOnStartup }) => {
    autoCheckOnStartup().catch((e) => log.warn('updater autocheck failed', { error: String(e) }));
  });
});

watch(() => settings.state.themeName, (n) => {
  themeStore.setActive(n);
  // Tema değiştiğinde font/chrome var'larını re-assert et — eski tema'nın
  // (HMR veya cache nedeniyle) :root'a yazmış olabileceği kalan değerleri
  // settings'in kanonik değerlerine geri çek. Tema sadece renk yönetir.
  applyFontVars();
  applyChromeVars();
});
watch(() => settings.state.language, (n) => { locale.value = n; });
watch(
  () => [settings.state.fontFamily, settings.state.fontSize] as const,
  applyFontVars,
);
watch(
  () => [settings.state.opacity, settings.state.blur] as const,
  applyChromeVars,
);
watch(
  () => settings.state.windowVibrancy,
  (mode) => {
    api.windowSetVibrancy(mode).catch((e) => {
      log.warn('window vibrancy switch failed', { error: String(e), mode });
    });
  },
);
// Prefix mode toggle/combo değişince registry'yi güncelle.
watch(
  () => [settings.state.prefixModeEnabled, settings.state.prefixCombo] as const,
  applyPrefixMode,
);
</script>

<template>
  <main class="shell">
    <!-- Frameless window: native title bar yok, bu header drag region.
         Çocuk butonlar `data-tauri-drag-region` taşımaz, normal click alır. -->
    <header class="shell__header" data-tauri-drag-region>
      <div class="shell__brand" data-tauri-drag-region>{{ t('app.title') }}</div>
      <span
        v-if="isElevated"
        class="shell__admin-badge"
        :title="t('admin.elevatedHint')"
        aria-label="Administrator"
      >
🛡 ADMIN
</span>
      <nav class="shell__menu">
        <button
          type="button"
          class="shell__menu-icon"
          :title="t('pane.new')"
          :aria-label="t('pane.new')"
          @click="openNewPane"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="2" width="12" height="12" rx="1.5" />
            <path d="M8 5v6M5 8h6" stroke-linecap="round" />
          </svg>
        </button>
        <button
          type="button"
          class="shell__menu-icon"
          :title="t('pane.splitHorizontal')"
          :aria-label="t('pane.splitHorizontal')"
          @click="splitH"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="2" width="12" height="12" rx="1.5" />
            <path d="M2 8h12" />
          </svg>
        </button>
        <button
          type="button"
          class="shell__menu-icon"
          :title="t('pane.splitVertical')"
          :aria-label="t('pane.splitVertical')"
          @click="splitV"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="2" width="12" height="12" rx="1.5" />
            <path d="M8 2v12" />
          </svg>
        </button>
        <span class="shell__menu-sep" />
        <button type="button" @click="openAi">{{ t('pane.type.aiChat') }}</button>
        <button type="button" @click="openHistory">{{ t('history.title') }}</button>
        <button type="button" @click="openSnippets">{{ t('snippet.title') }}</button>
        <span class="spacer" data-tauri-drag-region />
        <button id="cmd-palette-trigger" type="button" @click="openPalette">⌘ {{ t('commandPalette.placeholder') }}</button>
        <button type="button" :title="t('about.title')" @click="modals.open('about')">ℹ</button>
        <button
          type="button"
          class="shell__menu-icon"
          :title="t('settings.title')"
          :aria-label="t('settings.title')"
          @click="openSettings"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <!-- Lucide settings (cog-6-tooth) — gerçek dişli profili, ışın değil -->
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </nav>
      <!-- Custom window controls: native title bar yerine. Win11 estetiği:
           min/max gri hover, close kırmızı hover. -->
      <div class="shell__winctrl">
        <button
          type="button"
          class="winctrl winctrl--min"
          :title="t('window.minimize')"
          :aria-label="t('window.minimize')"
          @click="winMinimize"
        >
          <svg viewBox="0 0 10 10" width="10" height="10"><path d="M0 5h10" stroke="currentColor" stroke-width="1" /></svg>
        </button>
        <button
          type="button"
          class="winctrl winctrl--max"
          :title="t(windowMaximized ? 'window.restore' : 'window.maximize')"
          :aria-label="t(windowMaximized ? 'window.restore' : 'window.maximize')"
          @click="winToggleMax"
        >
          <svg v-if="!windowMaximized" viewBox="0 0 10 10" width="10" height="10">
            <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" fill="none" stroke-width="1" />
          </svg>
          <svg v-else viewBox="0 0 10 10" width="10" height="10">
            <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" fill="none" stroke-width="1" />
            <path d="M2.5 2.5V0.5h7v7H7.5" stroke="currentColor" fill="none" stroke-width="1" />
          </svg>
        </button>
        <button
          type="button"
          class="winctrl winctrl--close"
          :title="t('window.close')"
          :aria-label="t('window.close')"
          @click="winClose"
        >
          <svg viewBox="0 0 10 10" width="10" height="10">
            <path d="M0 0L10 10M10 0L0 10" stroke="currentColor" stroke-width="1" />
          </svg>
        </button>
      </div>
    </header>
    <TabBar />
    <PaneLayout />
    <StatusBar />
    <!-- Modallar lazy mount: kapalıyken script setup hiç çalışmaz, store
         dependency'leri tutulmaz. Açılınca mount, kapanınca destroy. -->
    <NewPaneDialog v-if="modals.state.newPane" :open="true" @close="modals.close('newPane')" @create="createPane" />
    <SettingsModal v-if="modals.state.settings" :open="true" @close="modals.close('settings')" />
    <HistoryModal v-if="modals.state.history" :open="true" @close="modals.close('history')" />
    <SnippetModal v-if="modals.state.snippets" :open="true" @close="modals.close('snippets')" />
    <SessionModal v-if="modals.state.session.open" :open="true" :mode="modals.state.session.mode" @close="modals.closeSession()" />
    <CommandPalette v-if="modals.state.commandPalette" :open="true" @close="modals.close('commandPalette')" @navigate="paletteNavigate" />
    <AboutModal v-if="modals.state.about" :open="true" @close="modals.close('about')" />
    <AISuggestModal v-if="modals.state.aiSuggest" :open="true" @close="modals.close('aiSuggest')" />
    <ContextMenu />
    <ToastContainer />
    <!-- Prefix-mode (tmux tarzı) aktif overlay — 1 sn pencere içinde
         kullanıcıya hangi tuşa basabileceği hatırlatılır. -->
    <div v-if="keybindings.prefixActive.value" class="prefix-overlay" aria-live="polite">
      <span class="prefix-overlay__label">PREFIX</span>
      <span class="prefix-overlay__hints">
        V/H · Z · X · N/P · T/W · S/O · Esc
      </span>
    </div>
  </main>
</template>

<style scoped>
.prefix-overlay {
  position: fixed;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  background: rgba(0, 0, 0, 0.85);
  border: 1px solid var(--color-accent);
  border-radius: 4px;
  color: var(--color-fg);
  font-family: var(--font-family);
  font-size: 11px;
  z-index: 1500;
  pointer-events: none;
  box-shadow: 0 0 12px var(--color-accent-glow);
}
.prefix-overlay__label {
  font-weight: 700;
  color: var(--color-accent);
  letter-spacing: 1px;
}
.prefix-overlay__hints {
  color: var(--color-dim);
  font-size: 10px;
}
.shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  /* Background body'de color-mix ile alpha alıyor; .shell transparent kalır
     ki pencere şeffaflığı (Mica/Acrylic) alttan görünsün. */
  background: transparent;
  color: var(--color-fg);
  font-family: var(--font-family);
}
.shell__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 0 0 10px;
  background: var(--color-overlay-light);
  border-bottom: 1px solid var(--color-line);
  flex-shrink: 0;
  user-select: none;
  font-size: 10px;
  height: 30px;
  /* Drag region Tauri 2 `data-tauri-drag-region` attribute ile yönetilir
     (template'te). -webkit-app-region (Electron-style) WebView2'de tutarsız
     davranıp click event'lerini yutuyordu, kaldırdık. */
}
/* Window control SVG'leri butona event'i devretsin — target hep button olsun */
.shell__header svg {
  pointer-events: none;
}
.shell__brand {
  font-weight: 700;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background: var(--pane-title-gradient, linear-gradient(90deg, var(--color-accent), var(--color-accent2)));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.shell__brand::before { content: '> '; }
.shell__admin-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 8px;
  padding: 1px 6px;
  background: var(--color-red-soft-15);
  border: 1px solid color-mix(in srgb, var(--color-red) 55%, transparent);
  border-radius: 2px;
  color: var(--color-red);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  font-family: var(--font-family);
}
.shell__menu {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
}
.shell__menu button {
  background: transparent;
  border: none;
  color: var(--color-dim);
  padding: 1px 8px;
  border-radius: 0;
  cursor: pointer;
  font-size: 10px;
  font-family: inherit;
  text-transform: lowercase;
}
.shell__menu button:hover {
  color: var(--color-accent);
  background: var(--color-accent-soft);
}
.shell__menu .spacer { flex: 1; }
/* Icon-only button — yeni panel / yatay böl / dikey böl için.
   SVG 14x14, görsel olarak 22x22 hit-area, hover tema accent'i. */
.shell__menu-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 22px;
  padding: 0 !important;
  color: var(--color-dim);
}
.shell__menu-icon:hover {
  color: var(--color-accent);
  background: var(--color-accent-soft);
}
.shell__menu-icon svg { display: block; }
.shell__menu-sep {
  width: 1px;
  height: 14px;
  background: var(--color-line);
  margin: 0 4px;
  flex-shrink: 0;
}

/* Window controls — Win11 native title bar yerine, frameless mode'da. */
.shell__winctrl {
  display: flex;
  height: 100%;
  margin-left: 4px;
  flex-shrink: 0;
}
.winctrl {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 100%;
  background: transparent;
  border: none;
  color: var(--color-fg);
  cursor: pointer;
  opacity: 0.85;
  transition: background 0.1s ease, color 0.1s ease;
}
.winctrl:hover {
  background: color-mix(in srgb, var(--color-fg) 12%, transparent);
  opacity: 1;
}
.winctrl--close:hover {
  background: #e81123;
  color: #ffffff;
}
.winctrl svg { display: block; }
</style>
