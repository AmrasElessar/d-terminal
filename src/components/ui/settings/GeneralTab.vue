<script setup lang="ts">
// Ayarlar → Genel: dil, başlangıç, güncelleme, otomatik başlatma, yönetici
// modu, ProcessJail durumu, Config-as-Code içe/dışa aktarma.
import { computed, onMounted, ref, watch } from 'vue';
import { enable as autostartEnable, disable as autostartDisable, isEnabled as autostartIsEnabled } from '@tauri-apps/plugin-autostart';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '@/stores/settings';
import { useToastsStore } from '@/stores/toasts';
import { api } from '@/api/tauri';
import { availableLocales, localeMeta, loadLocaleMeta } from '@/locales';
import { confirmAsk } from '@/utils/dialog';
import { createLogger } from '@/utils/logger';
import DarkSelect, { type DarkSelectOption } from '@/components/ui/DarkSelect.vue';

const log = createLogger('settings');
const { t, locale } = useI18n();
const settings = useSettingsStore();
const toasts = useToastsStore();

// --- Config as Code (TOML import/export) ---
const configPath = ref<string>('');

// --- Admin (UAC elevation) ---
const isElevated = ref(false);
// ProcessJail aktif mi? Job Object yaratıldıysa kill-on-close + console
// suppression garanti; aksi halde sadece spawn-time CREATE_NO_WINDOW
// fallback (heartbeat timeout zombi guard'ı).
const processJailActive = ref(false);
// Bir veya daha fazla child Job Object'e eklenememişse true. Sticky —
// session sonuna kadar uyarı badge'i kalır (heartbeat fallback aktif).
const processJailAssignFailed = ref(false);

onMounted(async () => {
  // Sessiz catch yasak — capability hataları sessiz yutulup UI yanlış güvenlik
  // durumu (elevated/jail false) gösterebilir. Logger'a düşürüp UI default'a
  // izin ver.
  try { configPath.value = await api.configDotfilePath(); } catch (e) { log.warn('configDotfilePath failed', { error: String(e) }); }
  try { isElevated.value = await api.adminIsElevated(); } catch (e) { log.warn('adminIsElevated failed', { error: String(e) }); }
  try { processJailActive.value = await api.processJailActive(); } catch (e) { log.warn('processJailActive failed', { error: String(e) }); }
  try { processJailAssignFailed.value = await api.processJailAssignFailed(); } catch (e) { log.warn('processJailAssignFailed failed', { error: String(e) }); }
  // Autostart durumunu backend (registry) ile hizala — kullanıcı manuel olarak
  // registry'yi düzenlemiş olabilir veya başka bir D-Terminal kurulumu mevcut
  // entry yazmış olabilir. Backend tek doğru kaynak.
  await syncAutostartFromBackend();
  // Settings modal açıldığında dil seçici listesi için raw _meta'yı lazy yükle.
  // Modal kapalıyken bu chunk yüklenmez (initial bundle ~100-150 KB hafifler).
  void loadLocaleMeta();
});

async function restartAsAdmin() {
  if (!(await confirmAsk(t('settings.general.adminRestartConfirm'), { kind: 'warning' }))) return;
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
  navigator.clipboard
    .writeText(cmd)
    .then(() => toasts.success(t('settings.general.gsudoCopied'), 3000))
    .catch((e) => toasts.error(t('errors.clipboard', { error: String(e) })));
}

const UPDATE_MODE_KEYS: Record<'off' | 'notify' | 'download-wait' | 'auto', string> = {
  off: 'settings.general.updateModeOff',
  notify: 'settings.general.updateModeNotify',
  'download-wait': 'settings.general.updateModeDownloadWait',
  auto: 'settings.general.updateModeAuto',
};
function updateModeLabel(mode: 'off' | 'notify' | 'download-wait' | 'auto'): string {
  return t(UPDATE_MODE_KEYS[mode]);
}

const UPDATE_FREQUENCY_KEYS: Record<import('@/stores/settings').UpdateCheckFrequency, string> = {
  startup: 'settings.general.updateFreq.startup',
  '1h': 'settings.general.updateFreq.h1',
  '6h': 'settings.general.updateFreq.h6',
  '12h': 'settings.general.updateFreq.h12',
  '24h': 'settings.general.updateFreq.h24',
};
function updateFrequencyLabel(freq: import('@/stores/settings').UpdateCheckFrequency): string {
  return t(UPDATE_FREQUENCY_KEYS[freq]);
}

const updateChecking = ref(false);

// Auto-start sync — backend registry state'i ile settings.state.autoStartOnBoot
// arasında köprü. Toggle değişince plugin enable/disable çağrılır; backend
// reject ederse state geri döner (Settings DB tutarsızlığını engelle). Sticky
// hata bildirimi yok — toast yeterli.
const autostartSyncing = ref(false);
async function syncAutostartFromBackend() {
  try {
    const actual = await autostartIsEnabled();
    if (actual !== settings.state.autoStartOnBoot) {
      // İlk açılışta backend gerçeği tek doğru kaynak — UI'yı backend'le hizala.
      autostartSyncing.value = true;
      settings.state.autoStartOnBoot = actual;
      Promise.resolve().then(() => { autostartSyncing.value = false; });
    }
  } catch (e) {
    console.warn('autostart isEnabled failed:', e);
  }
}
watch(
  () => settings.state.autoStartOnBoot,
  async (next, prev) => {
    if (autostartSyncing.value) return;
    try {
      if (next) await autostartEnable();
      else await autostartDisable();
    } catch (e) {
      console.warn('autostart toggle failed, rolling back:', e);
      autostartSyncing.value = true;
      settings.state.autoStartOnBoot = prev as boolean;
      Promise.resolve().then(() => { autostartSyncing.value = false; });
      toasts.error(t('settings.general.autoStartFailed'));
    }
  },
);
async function checkUpdateNow() {
  updateChecking.value = true;
  try {
    const { checkForUpdate } = await import('@/composables/useUpdater');
    await checkForUpdate(false);
  } finally {
    updateChecking.value = false;
  }
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
  if (!(await confirmAsk(t('settings.general.configImportConfirm'), { kind: 'warning' }))) return;
  try {
    const count = await api.configImport();
    toasts.success(t('settings.general.configImportOk', { count }), 4000);
    // Settings store'u yeniden yükle ki UI yeni değerleri yansıtsın
    await settings.load();
  } catch (e: unknown) {
    toasts.error(`${t('settings.general.configImportFail')}: ${(e as Error).message ?? e}`);
  }
}

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

async function applyLanguage(lang: string) {
  settings.state.language = lang;
  locale.value = lang;
}
</script>

<template>
  <section class="section">
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
    <label class="field row">
      <input v-model="settings.state.autoSplitOnAgent" type="checkbox" />
      <span>{{ t('settings.general.autoSplitOnAgent') }}</span>
    </label>
    <small class="note">{{ t('settings.general.autoSplitOnAgentHint') }}</small>
    <p class="note">{{ t('settings.general.telemetryHint') }}</p>

    <hr class="divider" />
    <h3 class="subhead">{{ t('settings.general.updateSection') }}</h3>
    <small class="note">{{ t('settings.general.updateModeHint') }}</small>
    <div class="update-modes">
      <label
        v-for="mode in (['off', 'notify', 'download-wait', 'auto'] as const)"
        :key="mode"
        class="field row update-mode"
      >
        <input
          v-model="settings.state.updateMode"
          type="radio"
          :value="mode"
        />
        <span>{{ updateModeLabel(mode) }}</span>
      </label>
    </div>

    <h4 class="subhead small">{{ t('settings.general.updateCheckFrequency') }}</h4>
    <small class="note">{{ t('settings.general.updateCheckFrequencyHint') }}</small>
    <div class="update-modes">
      <label
        v-for="freq in (['startup', '1h', '6h', '12h', '24h'] as const)"
        :key="freq"
        class="field row update-mode"
        :class="{ 'is-disabled': settings.state.updateMode === 'off' }"
      >
        <input
          v-model="settings.state.updateCheckFrequency"
          type="radio"
          :value="freq"
          :disabled="settings.state.updateMode === 'off'"
        />
        <span>{{ updateFrequencyLabel(freq) }}</span>
      </label>
    </div>

    <div class="config-actions">
      <button
        type="button"
        class="config-btn"
        :disabled="updateChecking"
        @click="checkUpdateNow"
      >
        ↻ {{ updateChecking ? t('settings.general.updateChecking') : t('settings.general.updateCheckNow') }}
      </button>
    </div>

    <hr class="divider" />
    <h3 class="subhead">{{ t('settings.general.autoStartSection') }}</h3>
    <label class="field row">
      <input v-model="settings.state.autoStartOnBoot" type="checkbox" />
      <span>{{ t('settings.general.autoStartOnBoot') }}</span>
    </label>
    <small class="note">{{ t('settings.general.autoStartOnBootHint') }}</small>

    <hr class="divider" />
    <h3 class="subhead">{{ t('settings.general.safetySection') }}</h3>
    <label class="field">
      <span>{{ t('settings.general.confirmOnClose') }}</span>
      <select v-model="settings.state.confirmOnClose" class="select">
        <option value="never">{{ t('settings.general.confirmOnCloseOptions.never') }}</option>
        <option value="runningOnly">{{ t('settings.general.confirmOnCloseOptions.runningOnly') }}</option>
        <option value="always">{{ t('settings.general.confirmOnCloseOptions.always') }}</option>
      </select>
    </label>
    <small class="note">{{ t('settings.general.confirmOnCloseHint') }}</small>

    <hr class="divider" />
    <h3 class="subhead">{{ t('settings.general.agentSection') }}</h3>
    <label class="field row">
      <input v-model="settings.state.agentHeuristicEnabled" type="checkbox" />
      <span>{{ t('settings.general.agentHeuristic') }}</span>
    </label>
    <small class="note">{{ t('settings.general.agentHeuristicHint') }}</small>

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
    <h3 class="subhead">{{ t('settings.general.privacySection') }}</h3>
    <label class="field row">
      <input v-model="settings.state.suppressConsoles" type="checkbox" />
      <span>{{ t('settings.general.suppressConsoles') }}</span>
    </label>
    <small class="note">{{ t('settings.general.suppressConsolesHint') }}</small>
    <p v-if="processJailActive" class="note small-note">
      ✓ {{ t('settings.general.jailActiveHint') }}
    </p>
    <p v-else class="note small-note">
      ⚠ {{ t('settings.general.jailInactiveHint') }}
    </p>
    <p v-if="processJailAssignFailed" class="note small-note" style="color: #f5a623;">
      ⚠ {{ t('settings.general.jailAssignFailedHint') }}
    </p>

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
</template>

<style scoped src="./settings.css"></style>
