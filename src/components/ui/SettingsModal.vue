<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '@/stores/settings';
import { useThemeStore } from '@/stores/theme';
import { useAIStore } from '@/stores/ai';
import { useTriggersStore } from '@/stores/triggers';
import { useProfilesStore } from '@/stores/profiles';
import { ALL_PROVIDER_IDS } from '@/providers/registry';
import { PROVIDER_CATEGORY } from '@/types/ai';

const cloudProviders = ALL_PROVIDER_IDS.filter((id) => PROVIDER_CATEGORY[id] === 'cloud');
const localProviders = ALL_PROVIDER_IDS.filter((id) => PROVIDER_CATEGORY[id] === 'local');

const DEFAULT_LOCAL_URL: Partial<Record<ProviderId, string>> = {
  ollama:   'localhost:11434',
  lmstudio: 'localhost:1234',
  jan:      'localhost:1337',
  llamacpp: 'localhost:8080',
  foundry:  'localhost:5273',
};

const LOCAL_DOWNLOAD_URL: Partial<Record<ProviderId, string>> = {
  ollama:   'https://ollama.com/download',
  lmstudio: 'https://lmstudio.ai',
  jan:      'https://jan.ai',
  llamacpp: 'https://github.com/ggerganov/llama.cpp/releases',
  foundry:  'https://github.com/microsoft/Foundry-Local',
};
import { BUNDLED_FONTS } from '@/fonts';
import type { ProviderId } from '@/types/ai';
import { defaultTrigger, type TriggerActionKind, type TriggerScope } from '@/types/trigger';
import { defaultProfile } from '@/types/profile';
import type { PaneType } from '@/types/pane';
import { keybindings } from '@/keybindings/registry';
import { DEFAULT_SHORTCUTS } from '@/keybindings/defaults';
import { api } from '@/api/tauri';
import { useToastsStore } from '@/stores/toasts';
import { onMounted } from 'vue';
import { availableLocales, localeMeta } from '@/locales';
import DarkSelect, { type DarkSelectOption } from '@/components/ui/DarkSelect.vue';
import AICostPanel from '@/components/ui/AICostPanel.vue';
import { useDialogA11y } from '@/composables/useDialogA11y';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const dialogEl = ref<HTMLElement | null>(null);
useDialogA11y(dialogEl, () => props.open, { onEscape: () => emit('close') });

const { t, locale } = useI18n();
const settings = useSettingsStore();
const themeStore = useThemeStore();
const ai = useAIStore();
const triggers = useTriggersStore();
const profiles = useProfilesStore();

type Tab = 'general' | 'appearance' | 'providers' | 'profiles' | 'triggers' | 'shortcuts' | 'aiCost';
const tab = ref<Tab>('general');

// --- Config as Code (TOML import/export) ---
const toasts = useToastsStore();
const configPath = ref<string>('');

// --- Admin (UAC elevation) ---
const isElevated = ref(false);

onMounted(async () => {
  try { configPath.value = await api.configDotfilePath(); } catch { /* boşalır */ }
  try { isElevated.value = await api.adminIsElevated(); } catch { /* default false */ }
});

async function restartAsAdmin() {
  if (!confirm(t('settings.general.adminRestartConfirm'))) return;
  try {
    await api.adminRestartElevated();
    // Process kapanacak, başka şey yapma
  } catch (e: unknown) {
    toasts.error(`${t('settings.general.adminRestartFail')}: ${(e as Error).message ?? e}`);
  }
}

async function openSudoSettings() {
  try {
    await api.adminOpenDevSettings();
  } catch (e: unknown) {
    toasts.error(`${(e as Error).message ?? e}`);
  }
}

function copyGsudoCommand() {
  const cmd = 'winget install gerardog.gsudo';
  navigator.clipboard.writeText(cmd).then(() => {
    toasts.success(t('settings.general.gsudoCopied'), 3000);
  });
}

async function exportConfig() {
  try {
    const path = await api.configExport();
    toasts.success(t('settings.general.configExportOk', { path }), 4000);
  } catch (e: unknown) {
    toasts.error(`${t('settings.general.configExportFail')}: ${(e as Error).message ?? e}`);
  }
}

async function importConfig() {
  if (!confirm(t('settings.general.configImportConfirm'))) return;
  try {
    const count = await api.configImport();
    toasts.success(t('settings.general.configImportOk', { count }), 4000);
    // Settings store'u yeniden yükle ki UI yeni değerleri yansıtsın
    await settings.load();
  } catch (e: unknown) {
    toasts.error(`${t('settings.general.configImportFail')}: ${(e as Error).message ?? e}`);
  }
}

// --- Profile editor state ---
const draftProfile = ref<ReturnType<typeof defaultProfile>>(defaultProfile());
const editingProfileId = ref<string | null>(null);
const draftArgs = ref<string>(''); // space-separated, kullanıcıya gösterilen
const draftEnv = ref<string>('');  // KEY=VALUE\nKEY2=VALUE2 formatı

function startNewProfile() {
  draftProfile.value = defaultProfile();
  draftArgs.value = '';
  draftEnv.value = '';
  editingProfileId.value = null;
}
function editProfile(id: string) {
  const p = profiles.find(id);
  if (!p || p.builtin) return;
  draftProfile.value = {
    name: p.name,
    shell: p.shell,
    args: [...p.args],
    cwd: p.cwd,
    env: { ...(p.env ?? {}) },
    icon: p.icon,
    paneType: p.paneType,
    builtin: false,
    color: p.color,
  };
  draftArgs.value = p.args.join(' ');
  draftEnv.value = Object.entries(p.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n');
  editingProfileId.value = id;
}
function parseArgs(raw: string): string[] {
  // Basit shell-quote parsing — boşluğa böl, "..." ve '...' içindekini birleşik tut
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  return out;
}
function parseEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}
function saveProfile() {
  const d = draftProfile.value;
  if (!d.name.trim() || !d.shell.trim()) return;
  const payload = {
    ...d,
    args: parseArgs(draftArgs.value),
    env: parseEnv(draftEnv.value),
  };
  if (editingProfileId.value) {
    profiles.update(editingProfileId.value, payload);
  } else {
    profiles.add(payload);
  }
  startNewProfile();
}
function duplicateProfile(id: string) {
  profiles.duplicate(id);
}

// --- Shortcuts editor state ---
interface ShortcutRow {
  id: string;
  combo: string;
  labelKey: string;
  defaultCombo: string;
  isOverridden: boolean;
}

const shortcutsSearch = ref('');
const shortcutEditingId = ref<string | null>(null);
const shortcutCaptureCombo = ref<string | null>(null);
const shortcutConflictWith = ref<string | null>(null);
// Tepki gözlemi için tick — registry mutate olduğunda recompute zorla
const shortcutsTick = ref(0);

const shortcutRows = computed<ShortcutRow[]>(() => {
  void shortcutsTick.value;
  const q = shortcutsSearch.value.trim().toLowerCase();
  return DEFAULT_SHORTCUTS.map((def) => {
    const current = keybindings.getCombo(def.id) ?? def.combo;
    return {
      id: def.id,
      combo: current,
      labelKey: def.labelKey,
      defaultCombo: def.combo,
      isOverridden: !!settings.state.shortcutOverrides[def.id],
    };
  }).filter((r) => {
    if (!q) return true;
    const label = t(r.labelKey).toLowerCase();
    return r.id.toLowerCase().includes(q) || label.includes(q) || r.combo.toLowerCase().includes(q);
  });
});

function startEditShortcut(id: string) {
  shortcutEditingId.value = id;
  shortcutCaptureCombo.value = null;
  shortcutConflictWith.value = null;
  // Window-level keydown ile tuş yakala
  window.addEventListener('keydown', captureShortcutKey, true);
}
function cancelEditShortcut() {
  shortcutEditingId.value = null;
  shortcutCaptureCombo.value = null;
  shortcutConflictWith.value = null;
  window.removeEventListener('keydown', captureShortcutKey, true);
}
function captureShortcutKey(e: KeyboardEvent) {
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') { cancelEditShortcut(); return; }
  // Modifier-only basıldıysa atla
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  let key = e.key;
  if (key === ' ') key = 'Space';
  if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  shortcutCaptureCombo.value = parts.join('+');
}
function applyShortcut() {
  if (!shortcutEditingId.value || !shortcutCaptureCombo.value) return;
  const id = shortcutEditingId.value;
  const combo = shortcutCaptureCombo.value;
  const conflict = keybindings.setCombo(id, combo);
  if (conflict) {
    shortcutConflictWith.value = conflict;
    return;
  }
  settings.state.shortcutOverrides = {
    ...settings.state.shortcutOverrides,
    [id]: combo,
  };
  shortcutsTick.value++;
  cancelEditShortcut();
}
function resetShortcut(id: string) {
  const def = DEFAULT_SHORTCUTS.find((d) => d.id === id);
  if (!def) return;
  keybindings.setCombo(id, def.combo);
  const overrides = { ...settings.state.shortcutOverrides };
  delete overrides[id];
  settings.state.shortcutOverrides = overrides;
  shortcutsTick.value++;
}
function resetAllShortcuts() {
  for (const def of DEFAULT_SHORTCUTS) {
    keybindings.setCombo(def.id, def.combo);
  }
  settings.state.shortcutOverrides = {};
  shortcutsTick.value++;
}

const draftTrigger = ref<ReturnType<typeof defaultTrigger>>(defaultTrigger());
const editingTriggerId = ref<string | null>(null);

function startNewTrigger() {
  draftTrigger.value = defaultTrigger();
  editingTriggerId.value = null;
}
function saveTrigger() {
  const d = draftTrigger.value;
  if (!d.name.trim() || !d.pattern.trim()) return;
  if (editingTriggerId.value) {
    triggers.update(editingTriggerId.value, d);
  } else {
    triggers.add(d);
  }
  startNewTrigger();
}
function editTrigger(id: string) {
  const t = triggers.triggers.find((x) => x.id === id);
  if (!t) return;
  draftTrigger.value = {
    name: t.name,
    pattern: t.pattern,
    flags: t.flags,
    scope: t.scope,
    action: { ...t.action },
    enabled: t.enabled,
    cooldownMs: t.cooldownMs,
  };
  editingTriggerId.value = id;
}

const newKey = ref<Record<ProviderId, string>>({} as Record<ProviderId, string>);

// Topluluk dil paketleri: `src/locales/*.json` olarak gelir, build-time pickup.
// Liste alfabetik kod sırasında — `localeMeta` üzerinden native isimle gösterilir.
// `completionPct ≥ 75` → kullanılabilir kabul edilir; daha düşüğü silik gösterilir.
const READY_THRESHOLD = 75;
const languageOptions = computed<DarkSelectOption[]>(() =>
  availableLocales.map((code) => {
    const meta = localeMeta[code];
    const completion = meta?.completion ?? '?';
    const pct = parseFloat(String(completion).replace('%', ''));
    const completionPct = Number.isFinite(pct) ? pct : 0;
    const ready = completionPct >= READY_THRESHOLD;
    const showBadge = completion !== '100%' && completion !== '?';
    return {
      value: code,
      label: meta?.nativeName || meta?.language || code,
      badge: showBadge ? completion : undefined,
      dim: !ready,
      highlight: ready,
    };
  }),
);

// Diğer dropdown'lar — hepsi DarkSelect kullanır (Webview2 native select bug'ı için).
const startupOptions = computed<DarkSelectOption[]>(() => [
  { value: 'welcome',     label: t('settings.general.startupOptions.welcome') },
  { value: 'lastSession', label: t('settings.general.startupOptions.lastSession') },
  { value: 'empty',       label: t('settings.general.startupOptions.empty') },
]);

const fontOptions = computed<DarkSelectOption[]>(() =>
  BUNDLED_FONTS.map((f) => ({
    value: f.family,
    label: f.label,
    badge: f.ligatures ? `ligatures · ${f.license}` : f.license,
  })),
);

const rendererOptions = computed<DarkSelectOption[]>(() => [
  { value: 'auto',   label: t('terminal.renderer.auto') },
  { value: 'webgl',  label: t('terminal.renderer.webgl') },
  { value: 'canvas', label: t('terminal.renderer.canvas') },
  { value: 'dom',    label: t('terminal.renderer.dom') },
]);

const vibrancyOptions = computed<DarkSelectOption[]>(() => [
  { value: 'auto',    label: t('settings.appearance.vibrancyAuto') },
  { value: 'mica',    label: t('settings.appearance.vibrancyMica') },
  { value: 'acrylic', label: t('settings.appearance.vibrancyAcrylic') },
  { value: 'none',    label: t('settings.appearance.vibrancyNone') },
]);

const paneTypeOptions: DarkSelectOption[] = [
  { value: 'powershell', label: 'powershell' },
  { value: 'cmd',        label: 'cmd' },
  { value: 'wsl',        label: 'wsl' },
];

const triggerScopeOptions: DarkSelectOption[] = [
  { value: 'all',        label: 'all' },
  { value: 'powershell', label: 'powershell' },
  { value: 'cmd',        label: 'cmd' },
  { value: 'wsl',        label: 'wsl' },
];

const triggerActionOptions = computed<DarkSelectOption[]>(() => [
  { value: 'toast',      label: t('triggers.action.toast') },
  { value: 'sendToAi',   label: t('triggers.action.sendToAi') },
  { value: 'runSnippet', label: t('triggers.action.runSnippet') },
  { value: 'capture',    label: t('triggers.action.capture') },
]);

async function applyLanguage(lang: string) {
  settings.state.language = lang;
  locale.value = lang;
}

async function applyTheme(name: string) {
  settings.state.themeName = name;
  themeStore.setActive(name);
}

async function saveKey(id: ProviderId) {
  const key = newKey.value[id]?.trim();
  if (!key) return;
  await ai.setKey(id, key);
  newKey.value[id] = '';
}

async function deleteKey(id: ProviderId) {
  await ai.removeKey(id);
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
    :aria-label="t('settings.title')"
    @click.self="emit('close')"
  >
    <article class="dialog__panel">
      <header class="dialog__header">
        <h2>{{ t('settings.title') }}</h2>
        <button type="button" class="close" @click="emit('close')">×</button>
      </header>
      <nav class="tabs">
        <button
          v-for="key in ['general', 'appearance', 'providers', 'profiles', 'triggers', 'shortcuts', 'aiCost'] as Tab[]"
          :key="key"
          type="button"
          :class="{ active: tab === key }"
          @click="tab = key"
        >
          {{ t(`settings.tabs.${key}`) }}
        </button>
      </nav>

      <section v-if="tab === 'general'" class="section">
        <label class="field">
          <span>{{ t('settings.general.language') }}</span>
          <DarkSelect
            :model-value="settings.state.language"
            :options="languageOptions"
            @update:model-value="applyLanguage"
          />
          <small>{{ t('settings.general.languageHint') }}</small>
        </label>
        <label class="field">
          <span>{{ t('settings.general.startup') }}</span>
          <DarkSelect v-model="settings.state.startup" :options="startupOptions" />
        </label>
        <label class="field row">
          <input v-model="settings.state.aiPrefixHash" type="checkbox" />
          <span>{{ t('settings.general.aiPrefixHash') }}</span>
        </label>
        <small class="note">{{ t('settings.general.aiPrefixHashHint') }}</small>
        <label class="field">
          <span>{{ t('settings.general.dfetchPollInterval') }}</span>
          <input
            v-model.number="settings.state.dfetchPollIntervalMs"
            type="number"
            min="0"
            max="60000"
            step="500"
          />
          <small>{{ t('settings.general.dfetchPollIntervalHint') }}</small>
        </label>
        <p class="note">{{ t('settings.general.telemetryHint') }}</p>

        <hr class="divider" />
        <h3 class="subhead">{{ t('settings.general.adminSection') }}</h3>
        <p class="note">
          <span v-if="isElevated">{{ t('settings.general.adminRunningAsAdmin') }}</span>
          <span v-else>{{ t('settings.general.adminRunningAsUser') }}</span>
        </p>
        <div class="config-actions">
          <button
            v-if="!isElevated"
            type="button"
            class="config-btn config-btn--accent"
            @click="restartAsAdmin"
          >
🛡 {{ t('settings.general.adminRestart') }}
</button>
        </div>
        <p class="note small-note">{{ t('settings.general.adminSudoHint') }}</p>
        <div class="config-actions">
          <button type="button" class="config-btn" @click="openSudoSettings">
⚙ {{ t('settings.general.adminOpenDevSettings') }}
</button>
          <button type="button" class="config-btn" @click="copyGsudoCommand">
⎘ {{ t('settings.general.adminCopyGsudo') }}
</button>
        </div>

        <hr class="divider" />
        <h3 class="subhead">{{ t('settings.general.configFile') }}</h3>
        <p class="note">{{ t('settings.general.configFileHint') }}</p>
        <p v-if="configPath" class="config-path"><code>{{ configPath }}</code></p>
        <div class="config-actions">
          <button type="button" class="config-btn config-btn--accent" @click="exportConfig">
            ↥ {{ t('settings.general.configExport') }}
          </button>
          <button type="button" class="config-btn" @click="importConfig">
            ↧ {{ t('settings.general.configImport') }}
          </button>
        </div>
      </section>

      <section v-if="tab === 'appearance'" class="section">
        <div class="field">
          <span>{{ t('settings.appearance.theme') }}</span>
          <small>{{ t('settings.appearance.themeHint') }}</small>
          <div class="theme-grid">
            <button
              v-for="theme in themeStore.themes"
              :key="theme.name"
              type="button"
              class="theme-card"
              :class="{ active: settings.state.themeName === theme.name }"
              :title="theme.description"
              :style="{
                background: theme.colors.background,
                color: theme.colors.foreground,
                borderColor: settings.state.themeName === theme.name ? theme.colors.accent : 'transparent',
              }"
              @click="applyTheme(theme.name)"
            >
              <div class="theme-card__head">
                <span class="theme-card__name" :style="{ color: theme.colors.accent }">{{ theme.name }}</span>
                <span v-if="settings.state.themeName === theme.name" class="theme-card__check" :style="{ color: theme.colors.accent }">●</span>
              </div>
              <div class="theme-card__sample">
                <span :style="{ color: theme.colors.red }">$</span>
                <span :style="{ color: theme.colors.green }">git</span>
                <span :style="{ color: theme.colors.yellow }">push</span>
                <span :style="{ color: theme.colors.blue }">origin</span>
                <span :style="{ color: theme.colors.magenta }">main</span>
              </div>
              <div class="theme-card__swatches">
                <span :style="{ background: theme.colors.black }" />
                <span :style="{ background: theme.colors.red }" />
                <span :style="{ background: theme.colors.green }" />
                <span :style="{ background: theme.colors.yellow }" />
                <span :style="{ background: theme.colors.blue }" />
                <span :style="{ background: theme.colors.magenta }" />
                <span :style="{ background: theme.colors.cyan }" />
                <span :style="{ background: theme.colors.white }" />
              </div>
            </button>
          </div>
        </div>
        <label class="field">
          <span>{{ t('settings.appearance.fontFamily') }}</span>
          <DarkSelect v-model="settings.state.fontFamily" :options="fontOptions" />
          <div
            class="font-preview"
            :style="{ fontFamily: settings.state.fontFamily }"
            aria-label="font preview"
          >const ƒ = (x ⇒ y) → x !== null && x.length > 0;</div>
        </label>
        <label class="field">
          <span>{{ t('settings.appearance.fontSize') }}</span>
          <input v-model.number="settings.state.fontSize" type="number" min="8" max="32" />
        </label>
        <label class="field row">
          <input v-model="settings.state.ligatures" type="checkbox" />
          <span>{{ t('settings.appearance.ligatures') }}</span>
        </label>
        <label class="field">
          <span>{{ t('settings.appearance.opacity') }} — {{ Math.round(settings.state.opacity * 100) }}%</span>
          <input
            v-model.number="settings.state.opacity"
            type="range" min="0.4" max="1" step="0.02"
          />
        </label>
        <label class="field">
          <span>{{ t('settings.appearance.blur') }} — {{ settings.state.blur }}px</span>
          <input
            v-model.number="settings.state.blur"
            type="range" min="0" max="40" step="2"
          />
        </label>
        <label class="field">
          <span>{{ t('settings.appearance.renderer') }}</span>
          <DarkSelect v-model="settings.state.renderer" :options="rendererOptions" />
          <small>{{ t('settings.appearance.rendererHint') }}</small>
        </label>
        <label class="field row">
          <input v-model="settings.state.unicode11" type="checkbox" />
          <span>{{ t('settings.appearance.unicode11') }}</span>
        </label>
        <label class="field row">
          <input v-model="settings.state.screenReaderMode" type="checkbox" />
          <span>{{ t('settings.appearance.screenReaderMode') }}</span>
          <small>{{ t('settings.appearance.screenReaderHint') }}</small>
        </label>
        <label class="field row">
          <input v-model="settings.state.prefixModeEnabled" type="checkbox" />
          <span>{{ t('settings.appearance.prefixMode') }}</span>
          <small>{{ t('settings.appearance.prefixModeHint') }}</small>
        </label>
        <label v-if="settings.state.prefixModeEnabled" class="field">
          <span>{{ t('settings.appearance.prefixCombo') }}</span>
          <input v-model="settings.state.prefixCombo" type="text" placeholder="Ctrl+B" />
        </label>
        <label class="field">
          <span>{{ t('settings.appearance.vibrancy') }}</span>
          <DarkSelect v-model="settings.state.windowVibrancy" :options="vibrancyOptions" />
          <small>{{ t('settings.appearance.vibrancyHint') }}</small>
        </label>
      </section>

      <section v-if="tab === 'providers'" class="section">
        <h3>{{ t('settings.providers.title') }}</h3>

        <!-- Bulut sağlayıcılar -->
        <div class="provider-group">
          <header class="section-head">
            <strong>☁ {{ t('settings.providers.cloud') }}</strong>
            <small>{{ t('settings.providers.cloudHint') }}</small>
          </header>
          <div v-for="id in cloudProviders" :key="id" class="provider">
            <div class="provider__header">
              <strong>{{ t(`ai.provider.${id}`) }}</strong>
              <span v-if="ai.statuses[id]?.hasKey" class="badge ok">{{ ai.statuses[id]?.maskedKey }}</span>
              <span v-else class="badge">{{ t('settings.providers.keyNotSet') }}</span>
            </div>
            <div class="provider__row">
              <input
                v-model="newKey[id]"
                type="password"
                :placeholder="t('settings.providers.addKey')"
              />
              <button type="button" class="primary" @click="saveKey(id)">{{ t('common.save') }}</button>
              <button
                v-if="ai.statuses[id]?.hasKey"
                type="button"
                class="ghost"
                @click="deleteKey(id)"
              >
                {{ t('settings.providers.removeKey') }}
              </button>
            </div>
            <small>{{ t('settings.providers.keyStored') }}</small>
          </div>
        </div>

        <!-- Yerel runtime'lar -->
        <div class="provider-group">
          <header class="section-head">
            <strong>💻 {{ t('settings.providers.local') }}</strong>
            <small>{{ t('settings.providers.localHint') }}</small>
          </header>
          <div v-for="id in localProviders" :key="id" class="provider provider--local">
            <div class="provider__header">
              <strong>{{ t(`ai.provider.${id}`) }}</strong>
              <code class="provider__url">{{ DEFAULT_LOCAL_URL[id] }}</code>
              <a v-if="LOCAL_DOWNLOAD_URL[id]" class="link" :href="LOCAL_DOWNLOAD_URL[id]" target="_blank" rel="noopener">
                ↗ {{ t('settings.providers.download') }}
              </a>
            </div>
            <small>{{ t(`settings.providers.localDesc.${id}`) }}</small>
          </div>
        </div>

        <!-- Custom (kullanıcı endpoint) -->
        <div class="provider-group">
          <header class="section-head">
            <strong>🔧 {{ t('settings.providers.customGroup') }}</strong>
            <small>{{ t('settings.providers.customHint') }}</small>
          </header>
          <div class="provider">
            <label class="field">
              <span>{{ t('settings.providers.customEndpoint') }}</span>
              <input
                v-model="settings.state.aiCustomEndpoint"
                type="text"
                placeholder="https://openrouter.ai/api/v1"
                @blur="ai.refresh()"
              />
              <small>{{ t('settings.providers.customEndpointHint') }}</small>
            </label>
            <div class="provider__header" style="margin-top: 8px;">
              <strong>{{ t('settings.providers.customApiKey') }}</strong>
              <span v-if="ai.statuses.custom?.maskedKey" class="badge ok">{{ ai.statuses.custom.maskedKey }}</span>
              <span v-else class="badge">{{ t('settings.providers.keyNotSet') }}</span>
            </div>
            <div class="provider__row">
              <input
                v-model="newKey.custom"
                type="password"
                :placeholder="t('settings.providers.addKey')"
              />
              <button type="button" class="primary" @click="saveKey('custom')">{{ t('common.save') }}</button>
              <button
                v-if="ai.statuses.custom?.maskedKey"
                type="button"
                class="ghost"
                @click="deleteKey('custom')"
              >
                {{ t('settings.providers.removeKey') }}
              </button>
            </div>
            <small>{{ t('settings.providers.customKeyHint') }}</small>
          </div>
        </div>
      </section>

      <section v-if="tab === 'profiles'" class="section">
        <header class="section-head">
          <strong>{{ t('profiles.title') }}</strong>
          <button type="button" class="ghost" @click="startNewProfile">＋ {{ t('profiles.new') }}</button>
        </header>
        <small class="note">{{ t('profiles.hint') }}</small>

        <div class="trigger-list">
          <div
            v-for="p in profiles.all"
            :key="p.id"
            class="trigger-row"
            :style="p.color ? { borderLeft: `3px solid ${p.color}` } : {}"
          >
            <span class="profile-icon">{{ p.icon }}</span>
            <div class="trigger-row__info">
              <strong>{{ p.name }}<span v-if="p.builtin" class="badge"> · built-in</span></strong>
              <code>{{ p.shell }} {{ p.args.join(' ') }}</code>
            </div>
            <button v-if="!p.builtin" type="button" class="ghost" @click="editProfile(p.id)">
              {{ t('common.edit') }}
            </button>
            <button type="button" class="ghost" @click="duplicateProfile(p.id)">
              {{ t('profiles.duplicate') }}
            </button>
            <button v-if="!p.builtin" type="button" class="ghost danger" @click="profiles.remove(p.id)">
              {{ t('common.delete') }}
            </button>
          </div>
        </div>

        <fieldset class="trigger-form">
          <legend>{{ editingProfileId ? t('profiles.edit') : t('profiles.new') }}</legend>
          <div class="row-2">
            <label class="field">
              <span>{{ t('profiles.field.name') }}</span>
              <input v-model="draftProfile.name" type="text" :placeholder="t('profiles.field.namePh')" />
            </label>
            <label class="field">
              <span>{{ t('profiles.field.icon') }}</span>
              <input v-model="draftProfile.icon" type="text" maxlength="2" />
            </label>
          </div>
          <label class="field">
            <span>{{ t('profiles.field.shell') }}</span>
            <input
              v-model="draftProfile.shell"
              type="text"
              :placeholder="t('profiles.field.shellPh')"
              class="mono"
            />
            <small>{{ t('profiles.field.shellHint') }}</small>
          </label>
          <label class="field">
            <span>{{ t('profiles.field.args') }}</span>
            <input
              v-model="draftArgs"
              type="text"
              :placeholder="t('profiles.field.argsPh')"
              class="mono"
            />
            <small>{{ t('profiles.field.argsHint') }}</small>
          </label>
          <div class="row-2">
            <label class="field">
              <span>{{ t('profiles.field.cwd') }}</span>
              <input v-model="draftProfile.cwd" type="text" :placeholder="t('profiles.field.cwdPh')" class="mono" />
            </label>
            <label class="field">
              <span>{{ t('profiles.field.paneType') }}</span>
              <DarkSelect v-model="draftProfile.paneType" :options="paneTypeOptions" />
            </label>
          </div>
          <label class="field">
            <span>{{ t('profiles.field.env') }}</span>
            <textarea
              v-model="draftEnv"
              rows="3"
              class="mono"
              :placeholder="'HTTP_PROXY=http://proxy:8080\nLANG=en_US.UTF-8'"
            />
          </label>
          <label class="field">
            <span>{{ t('profiles.field.color') }}</span>
            <input v-model="draftProfile.color" type="color" />
          </label>
          <div class="row-2">
            <button type="button" class="primary" @click="saveProfile">
              {{ editingProfileId ? t('common.save') : t('profiles.add') }}
            </button>
            <button v-if="editingProfileId" type="button" class="ghost" @click="startNewProfile">
              {{ t('common.cancel') }}
            </button>
          </div>
        </fieldset>
      </section>

      <section v-if="tab === 'triggers'" class="section">
        <header class="section-head">
          <strong>{{ t('triggers.title') }}</strong>
          <button type="button" class="ghost" @click="startNewTrigger">
            ＋ {{ t('triggers.new') }}
          </button>
        </header>
        <small class="note">{{ t('triggers.hint') }}</small>

        <!-- Existing triggers list -->
        <div class="trigger-list">
          <div v-if="triggers.triggers.length === 0" class="empty">
            {{ t('triggers.empty') }}
          </div>
          <div
            v-for="trg in triggers.triggers"
            :key="trg.id"
            class="trigger-row"
            :class="{ 'is-disabled': !trg.enabled }"
          >
            <input
              type="checkbox"
              :checked="trg.enabled"
              @change="triggers.toggle(trg.id)"
            />
            <div class="trigger-row__info">
              <strong>{{ trg.name || '(unnamed)' }}</strong>
              <code>/{{ trg.pattern }}/{{ trg.flags }}</code>
              <span class="badge">{{ trg.scope }} → {{ trg.action.kind }}</span>
            </div>
            <button type="button" class="ghost" @click="editTrigger(trg.id)">
              {{ t('common.edit') }}
            </button>
            <button type="button" class="ghost danger" @click="triggers.remove(trg.id)">
              {{ t('common.delete') }}
            </button>
          </div>
        </div>

        <!-- Create / edit form -->
        <fieldset class="trigger-form">
          <legend>{{ editingTriggerId ? t('triggers.edit') : t('triggers.new') }}</legend>
          <label class="field">
            <span>{{ t('triggers.field.name') }}</span>
            <input v-model="draftTrigger.name" type="text" :placeholder="t('triggers.field.namePh')" />
          </label>
          <label class="field">
            <span>{{ t('triggers.field.pattern') }}</span>
            <input
              v-model="draftTrigger.pattern"
              type="text"
              :placeholder="t('triggers.field.patternPh')"
              class="mono"
            />
          </label>
          <div class="row-2">
            <label class="field">
              <span>{{ t('triggers.field.flags') }}</span>
              <input v-model="draftTrigger.flags" type="text" placeholder="i" class="mono" />
            </label>
            <label class="field">
              <span>{{ t('triggers.field.scope') }}</span>
              <DarkSelect v-model="draftTrigger.scope" :options="triggerScopeOptions" />
            </label>
          </div>
          <div class="row-2">
            <label class="field">
              <span>{{ t('triggers.field.action') }}</span>
              <DarkSelect v-model="draftTrigger.action.kind" :options="triggerActionOptions" />
            </label>
            <label class="field">
              <span>{{ t('triggers.field.cooldown') }}</span>
              <input v-model.number="draftTrigger.cooldownMs" type="number" min="0" max="60000" step="100" />
            </label>
          </div>
          <label class="field">
            <span>{{ t('triggers.field.payload') }}</span>
            <input
              v-model="draftTrigger.action.payload"
              type="text"
              :placeholder="t('triggers.field.payloadPh')"
              class="mono"
            />
            <small>{{ t('triggers.field.payloadHint') }}</small>
          </label>
          <div class="row-2">
            <button type="button" class="primary" @click="saveTrigger">
              {{ editingTriggerId ? t('common.save') : t('triggers.add') }}
            </button>
            <button v-if="editingTriggerId" type="button" class="ghost" @click="startNewTrigger">
              {{ t('common.cancel') }}
            </button>
          </div>
        </fieldset>
      </section>

      <section v-if="tab === 'aiCost'" class="section">
        <AICostPanel />
      </section>

      <section v-if="tab === 'shortcuts'" class="section">
        <header class="section-head">
          <strong>{{ t('settings.shortcuts.title') }}</strong>
          <button type="button" class="ghost" @click="resetAllShortcuts">
            ↺ {{ t('settings.shortcuts.reset') }}
          </button>
        </header>
        <input
          v-model="shortcutsSearch"
          type="search"
          class="prompt-input"
          :placeholder="t('settings.shortcuts.search')"
          spellcheck="false"
        />

        <div class="shortcut-list">
          <div v-for="row in shortcutRows" :key="row.id" class="shortcut-row">
            <div class="shortcut-row__info">
              <strong>{{ t(row.labelKey) }}</strong>
              <small class="dim">{{ row.id }}</small>
            </div>
            <kbd class="combo" :class="{ overridden: row.isOverridden }">{{ row.combo }}</kbd>
            <button type="button" class="ghost" @click="startEditShortcut(row.id)">
              {{ t('settings.shortcuts.edit') }}
            </button>
            <button
              v-if="row.isOverridden"
              type="button"
              class="ghost"
              :title="`${t('settings.shortcuts.reset')}: ${row.defaultCombo}`"
              @click="resetShortcut(row.id)"
            >
↺
</button>
          </div>
        </div>
      </section>

      <!-- Shortcut capture overlay (in-place key recorder) -->
      <Teleport to="body">
        <div v-if="shortcutEditingId" class="capture-backdrop" @click.self="cancelEditShortcut">
          <div class="capture-panel">
            <h3>{{ t('settings.shortcuts.captureTitle') }}</h3>
            <p class="dim">{{ t('settings.shortcuts.captureHint') }}</p>
            <kbd v-if="shortcutCaptureCombo" class="combo big">{{ shortcutCaptureCombo }}</kbd>
            <kbd v-else class="combo big waiting">…</kbd>
            <p v-if="shortcutConflictWith" class="error">
              {{ t('settings.shortcuts.conflict', { action: shortcutConflictWith }) }}
            </p>
            <div class="capture-actions">
              <button type="button" class="ghost" @click="cancelEditShortcut">{{ t('common.cancel') }}</button>
              <button
                type="button"
                class="primary"
                :disabled="!shortcutCaptureCombo"
                @click="applyShortcut"
              >
{{ t('common.save') }}
</button>
            </div>
          </div>
        </div>
      </Teleport>
    </article>
  </dialog>
</template>

<style scoped>
.dialog {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  background: var(--color-overlay-medium);
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  padding: 0;
  z-index: 100;
}
.dialog__panel {
  background: var(--color-bg);
  border: 1px solid color-mix(in srgb, var(--color-fg) 8%, transparent);
  border-radius: var(--ui-radius, 8px);
  width: min(720px, 92vw);
  max-height: 80vh;
  overflow-y: auto;
  color: var(--color-fg);
}
.dialog__header {
  display: flex;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-fg) 5%, transparent);
}
.dialog__header h2 { margin: 0; font-size: 16px; flex: 1; }
.close { background: transparent; border: none; color: var(--color-fg); cursor: pointer; font-size: 22px; line-height: 1; }
.tabs {
  display: flex;
  gap: 4px;
  padding: 8px 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-fg) 5%, transparent);
}
.tabs button {
  background: transparent;
  border: none;
  color: var(--color-fg);
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0.6;
}
.tabs button.active {
  background: color-mix(in srgb, var(--color-fg) 5%, transparent);
  opacity: 1;
  color: var(--color-accent);
}
.section { padding: 20px; display: flex; flex-direction: column; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field.row { flex-direction: row; align-items: center; gap: 8px; }
.field span { font-size: 12px; opacity: 0.8; }
.field small { font-size: 11px; opacity: 0.5; }
.field input, .field select {
  background: color-mix(in srgb, var(--color-fg) 3%, transparent);
  color: var(--color-fg);
  border: 1px solid color-mix(in srgb, var(--color-fg) 10%, transparent);
  border-radius: 4px;
  padding: 6px 8px;
  font-family: inherit;
}
.font-preview {
  margin-top: 6px;
  padding: 8px 10px;
  background: var(--color-overlay-light);
  border-left: 2px solid var(--color-accent);
  color: var(--color-fg);
  font-size: 12px;
  font-feature-settings: 'liga', 'calt';
  white-space: nowrap;
  overflow-x: auto;
}
.note { font-size: 12px; opacity: 0.6; margin: 0; }
.divider { border: none; border-top: 1px solid color-mix(in srgb, var(--color-fg) 6%, transparent); margin: 6px 0; }
.subhead {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0;
  opacity: 0.7;
}
.config-path {
  font-size: 11px;
  opacity: 0.7;
  margin: 0;
  background: color-mix(in srgb, var(--color-fg) 3%, transparent);
  padding: 6px 8px;
  border-radius: 3px;
  word-break: break-all;
  font-family: var(--font-family);
}
.config-actions { display: flex; gap: 6px; margin-top: 4px; flex-wrap: wrap; }
.small-note { font-size: 11px; opacity: 0.55; margin: 8px 0 4px; }
.config-btn {
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--color-fg) 10%, transparent);
  color: var(--color-fg);
  font-family: var(--font-family);
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 3px;
  cursor: pointer;
  opacity: 0.85;
  transition: all 0.12s ease;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.config-btn:hover {
  opacity: 1;
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.config-btn--accent {
  border-color: color-mix(in srgb, var(--color-accent) 40%, transparent);
  color: var(--color-accent);
}
.provider-group { margin-top: 12px; }
.provider { padding: 12px; background: color-mix(in srgb, var(--color-fg) 2%, transparent); border-radius: 6px; margin-bottom: 8px; }
.provider--local { background: color-mix(in srgb, var(--color-accent) 4%, transparent); }
.provider__url {
  font-size: 11px;
  background: color-mix(in srgb, var(--color-fg) 6%, transparent);
  padding: 1px 6px;
  border-radius: 3px;
  margin-left: 6px;
  opacity: 0.8;
}
.provider__header .link {
  margin-left: auto;
  font-size: 11px;
  color: var(--color-accent);
  text-decoration: none;
}
.provider__header .link:hover { text-decoration: underline; }
.provider__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.badge {
  background: color-mix(in srgb, var(--color-fg) 6%, transparent);
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  opacity: 0.8;
}
.badge.ok {
  background: color-mix(in srgb, var(--color-green) 14%, transparent);
  color: var(--color-green);
  font-family: var(--font-family);
}
.provider__row {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}
.provider__row input {
  flex: 1;
  background: color-mix(in srgb, var(--color-fg) 4%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-fg) 10%, transparent);
  color: var(--color-fg);
  padding: 6px 8px;
  border-radius: 4px;
  font-family: var(--font-family);
}
/* Compact, ghost-style butonlar — terminal estetiğine uygun, hantal değil.
   Primary: accent kenarlık + dolgu yarı saydam, hover'da koyulaşır.
   Ghost  : nötr kenarlık, hover'da accent rengine geçer. */
.primary {
  background: var(--color-accent-soft-12);
  color: var(--color-accent);
  border: 1px solid color-mix(in srgb, var(--color-accent) 45%, transparent);
  font-family: var(--font-family);
  font-size: 11px;
  padding: 4px 12px;
  border-radius: 3px;
  cursor: pointer;
  font-weight: 600;
  letter-spacing: 0.02em;
  transition: all 0.12s ease;
}
.primary:hover {
  background: var(--color-accent-soft-22);
  border-color: var(--color-accent);
}
.primary:disabled { opacity: 0.4; cursor: not-allowed; }
.ghost {
  background: transparent;
  color: var(--color-fg);
  border: 1px solid color-mix(in srgb, var(--color-fg) 10%, transparent);
  font-family: var(--font-family);
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 3px;
  cursor: pointer;
  opacity: 0.85;
  transition: all 0.12s ease;
}
.ghost:hover {
  opacity: 1;
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.ghost.danger {
  color: var(--color-red);
  border-color: var(--color-red-soft-30);
}
.ghost.danger:hover {
  background: color-mix(in srgb, var(--color-red) 10%, transparent);
  border-color: var(--color-red);
  color: var(--color-red);
}

/* --- Triggers --- */
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.trigger-list { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
.trigger-list .empty { padding: 16px; text-align: center; color: var(--color-dim); font-size: 11px; }
.trigger-row {
  display: grid;
  grid-template-columns: 18px 1fr auto auto;
  gap: 8px;
  align-items: center;
  padding: 6px 8px;
  background: color-mix(in srgb, var(--color-fg) 2%, transparent);
  border-radius: 4px;
}
.trigger-row.is-disabled { opacity: 0.5; }
.trigger-row__info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.trigger-row__info strong { font-size: 12px; }
.trigger-row__info code {
  font-family: var(--font-family);
  font-size: 10px;
  color: var(--color-accent);
  background: var(--color-overlay-faint);
  padding: 1px 4px;
  border-radius: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.trigger-row__info .badge {
  font-size: 10px;
  color: var(--color-dim);
}
.trigger-form {
  margin-top: 12px;
  border: 1px solid color-mix(in srgb, var(--color-fg) 8%, transparent);
  border-radius: 6px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.trigger-form legend {
  font-size: 11px;
  color: var(--color-accent);
  padding: 0 4px;
}
.row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.mono { font-family: var(--font-family); font-size: 12px; }
.profile-icon { font-size: 16px; text-align: center; }

/* --- Theme grid --- */
.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
  margin-top: 6px;
}
.theme-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border-radius: 6px;
  border: 2px solid transparent;
  cursor: pointer;
  font-family: var(--font-family);
  text-align: left;
  transition: transform 0.1s ease, border-color 0.1s ease;
  outline: none;
}
.theme-card:hover { transform: translateY(-1px); }
.theme-card.active { box-shadow: 0 4px 16px var(--color-overlay-faint); }
.theme-card__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
}
.theme-card__check { font-size: 10px; }
.theme-card__sample {
  display: flex;
  gap: 6px;
  font-size: 11px;
  font-family: var(--font-family);
}
.theme-card__swatches {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
  height: 8px;
}
.theme-card__swatches span {
  display: block;
  border-radius: 1px;
}
.field textarea {
  background: color-mix(in srgb, var(--color-fg) 3%, transparent);
  color: var(--color-fg);
  border: 1px solid color-mix(in srgb, var(--color-fg) 10%, transparent);
  border-radius: 4px;
  padding: 6px 8px;
  font-family: inherit;
  resize: vertical;
}

/* --- Shortcuts --- */
.prompt-input {
  background: var(--color-overlay-faint);
  color: var(--color-fg);
  border: 1px solid var(--color-line);
  border-radius: 4px;
  padding: 6px 10px;
  font-family: var(--font-family);
  font-size: 12px;
  outline: none;
  width: 100%;
  margin-bottom: 8px;
}
.prompt-input:focus { border-color: var(--color-accent); }
.shortcut-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 50vh;
  overflow-y: auto;
}
.shortcut-row {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  gap: 10px;
  align-items: center;
  padding: 6px 10px;
  background: color-mix(in srgb, var(--color-fg) 2%, transparent);
  border-radius: 4px;
}
.shortcut-row:hover { background: color-mix(in srgb, var(--color-fg) 4%, transparent); }
.shortcut-row__info { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.shortcut-row__info strong { font-size: 12px; }
.shortcut-row__info .dim { font-size: 10px; opacity: 0.5; font-family: var(--font-family); }
.combo {
  font-family: var(--font-family);
  font-size: 11px;
  background: var(--color-overlay-light);
  color: var(--color-accent);
  padding: 3px 8px;
  border-radius: 3px;
  border: 1px solid var(--color-line);
}
.combo.overridden { border-color: var(--color-accent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-accent) 20%, transparent); }

/* Capture overlay */
.capture-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  backdrop-filter: blur(4px);
}
.capture-panel {
  background: var(--color-bg);
  border: 2px solid var(--color-accent);
  border-radius: 8px;
  padding: 28px;
  min-width: 360px;
  text-align: center;
  box-shadow: 0 16px 64px rgba(0, 0, 0, 0.7);
}
.capture-panel h3 { margin: 0 0 4px 0; font-size: 14px; color: var(--color-accent); }
.capture-panel .dim { margin: 0 0 16px 0; font-size: 11px; color: var(--color-dim); }
.combo.big {
  display: inline-block;
  font-size: 18px;
  padding: 8px 20px;
  margin: 8px 0 16px 0;
  letter-spacing: 0.04em;
}
.combo.big.waiting { color: var(--color-dim); border-style: dashed; }
.capture-panel .error {
  color: var(--color-red);
  font-size: 11px;
  margin: 0 0 12px 0;
}
.capture-actions { display: flex; gap: 8px; justify-content: flex-end; }
</style>
