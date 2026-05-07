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
import { fallbackChain } from '@/fonts';
import { api } from '@/api/tauri';
import { createLogger } from '@/utils/logger';
import { useModals } from '@/composables/useModals';
import PaneLayout from '@/components/layout/PaneLayout.vue';
import StatusBar from '@/components/ui/StatusBar.vue';
import ContextMenu from '@/components/ui/ContextMenu.vue';
import TabBar from '@/components/ui/TabBar.vue';
import ToastContainer from '@/components/ui/ToastContainer.vue';

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

/** Aktif font + boyut'u CSS değişkenlerine yansıt — UI ile xterm aynı görünür. */
function applyFontVars() {
  const root = document.documentElement;
  root.style.setProperty('--font-family', fallbackChain(settings.state.fontFamily));
  root.style.setProperty('--font-size', `${settings.state.fontSize}px`);
}

/** Pencere arka plan opaklığı + blur — Tauri window transparent ile birlikte çalışır. */
function applyChromeVars() {
  const root = document.documentElement;
  root.style.setProperty('--bg-alpha', String(settings.state.opacity));
  root.style.setProperty('--ui-blur', `${settings.state.blur}px`);
}

/** WebView2 DevTools toggle (Tauri 2 debug feature ile çalışır; tip kütüphanesinde
 * `openDevtools` yok ama runtime mevcut). */
async function toggleDevTools() {
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
  await settings.load();
  locale.value = settings.state.language;
  await themeStore.load();
  themeStore.setActive(settings.state.themeName);
  await ai.refresh();
  await snippets.load();
  await triggers.load();
  await profiles.load();
  await panes.startListening();
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
  keybindings.register('app.devTools', toggleDevTools);
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
    <header class="shell__header">
      <div class="shell__brand">{{ t('app.title') }}</div>
      <span
        v-if="isElevated"
        class="shell__admin-badge"
        :title="t('admin.elevatedHint')"
        aria-label="Administrator"
      >
🛡 ADMIN
</span>
      <nav class="shell__menu">
        <button type="button" @click="openNewPane">{{ t('pane.new') }}</button>
        <button type="button" @click="splitH">{{ t('pane.splitHorizontal') }}</button>
        <button type="button" @click="splitV">{{ t('pane.splitVertical') }}</button>
        <button type="button" @click="openAi">{{ t('pane.type.aiChat') }}</button>
        <button type="button" @click="openHistory">{{ t('history.title') }}</button>
        <button type="button" @click="openSnippets">{{ t('snippet.title') }}</button>
        <span class="spacer" />
        <button type="button" @click="openPalette">⌘ {{ t('commandPalette.placeholder') }}</button>
        <button type="button" :title="t('about.title')" @click="modals.open('about')">ℹ</button>
        <button type="button" @click="openSettings">{{ t('settings.title') }}</button>
      </nav>
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
  padding: 2px 8px;
  background: var(--color-overlay-light);
  border-bottom: 1px solid var(--color-line);
  flex-shrink: 0;
  user-select: none;
  font-size: 10px;
  height: 22px;
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
</style>
