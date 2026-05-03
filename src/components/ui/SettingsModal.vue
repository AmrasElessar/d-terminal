<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '@/stores/settings';
import { useThemeStore } from '@/stores/theme';
import { useAIStore } from '@/stores/ai';
import { useTriggersStore } from '@/stores/triggers';
import { useProfilesStore } from '@/stores/profiles';
import { ALL_PROVIDER_IDS } from '@/providers/registry';
import { BUNDLED_FONTS } from '@/fonts';
import type { ProviderId } from '@/types/ai';
import { defaultTrigger, type TriggerActionKind, type TriggerScope } from '@/types/trigger';
import { defaultProfile } from '@/types/profile';
import type { PaneType } from '@/types/pane';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const { t, locale } = useI18n();
const settings = useSettingsStore();
const themeStore = useThemeStore();
const ai = useAIStore();
const triggers = useTriggersStore();
const profiles = useProfilesStore();

type Tab = 'general' | 'appearance' | 'providers' | 'profiles' | 'triggers' | 'shortcuts';
const tab = ref<Tab>('general');

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

async function applyLanguage(lang: 'tr' | 'en') {
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
  <dialog v-if="open" class="dialog" open @click.self="emit('close')">
    <article class="dialog__panel">
      <header class="dialog__header">
        <h2>{{ t('settings.title') }}</h2>
        <button type="button" class="close" @click="emit('close')">×</button>
      </header>
      <nav class="tabs">
        <button
          v-for="key in ['general', 'appearance', 'providers', 'profiles', 'triggers', 'shortcuts'] as Tab[]"
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
          <select :value="settings.state.language" @change="applyLanguage(($event.target as HTMLSelectElement).value as 'tr' | 'en')">
            <option value="tr">Türkçe</option>
            <option value="en">English</option>
          </select>
          <small>{{ t('settings.general.languageHint') }}</small>
        </label>
        <label class="field">
          <span>{{ t('settings.general.startup') }}</span>
          <select v-model="settings.state.startup">
            <option value="welcome">{{ t('settings.general.startupOptions.welcome') }}</option>
            <option value="lastSession">{{ t('settings.general.startupOptions.lastSession') }}</option>
            <option value="empty">{{ t('settings.general.startupOptions.empty') }}</option>
          </select>
        </label>
        <label class="field row">
          <input v-model="settings.state.aiPrefixHash" type="checkbox" />
          <span>{{ t('settings.general.aiPrefixHash') }}</span>
        </label>
        <small class="note">{{ t('settings.general.aiPrefixHashHint') }}</small>
        <p class="note">{{ t('settings.general.telemetryHint') }}</p>
      </section>

      <section v-if="tab === 'appearance'" class="section">
        <label class="field">
          <span>{{ t('settings.appearance.theme') }}</span>
          <select :value="settings.state.themeName" @change="applyTheme(($event.target as HTMLSelectElement).value)">
            <option v-for="theme in themeStore.themes" :key="theme.name" :value="theme.name">{{ theme.name }}</option>
          </select>
          <small>{{ t('settings.appearance.themeHint') }}</small>
        </label>
        <label class="field">
          <span>{{ t('settings.appearance.fontFamily') }}</span>
          <select v-model="settings.state.fontFamily">
            <option v-for="font in BUNDLED_FONTS" :key="font.family" :value="font.family">
              {{ font.label }}{{ font.ligatures ? ' · ligatures' : '' }} ({{ font.license }})
            </option>
          </select>
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
          <select v-model="settings.state.renderer">
            <option value="auto">{{ t('terminal.renderer.auto') }}</option>
            <option value="webgl">{{ t('terminal.renderer.webgl') }}</option>
            <option value="canvas">{{ t('terminal.renderer.canvas') }}</option>
            <option value="dom">{{ t('terminal.renderer.dom') }}</option>
          </select>
          <small>{{ t('settings.appearance.rendererHint') }}</small>
        </label>
        <label class="field row">
          <input v-model="settings.state.unicode11" type="checkbox" />
          <span>{{ t('settings.appearance.unicode11') }}</span>
        </label>
      </section>

      <section v-if="tab === 'providers'" class="section">
        <h3>{{ t('settings.providers.title') }}</h3>
        <div v-for="id in ALL_PROVIDER_IDS" :key="id" class="provider">
          <div class="provider__header">
            <strong>{{ t(`ai.provider.${id}`) }}</strong>
            <span v-if="id === 'ollama'" class="badge">{{ t('settings.providers.keyStored').split(' ')[0] }}</span>
            <span v-else-if="ai.statuses[id]?.hasKey" class="badge ok">{{ ai.statuses[id]?.maskedKey }}</span>
            <span v-else class="badge">{{ t('settings.providers.keyNotSet') }}</span>
          </div>
          <div v-if="id !== 'ollama'" class="provider__row">
            <input
              v-model="newKey[id]"
              type="password"
              :placeholder="t('settings.providers.addKey')"
            />
            <button type="button" class="primary" @click="saveKey(id)">
              {{ t('common.save') }}
            </button>
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
              <select v-model="draftProfile.paneType">
                <option v-for="t2 in (['powershell','cmd','wsl'] as PaneType[])" :key="t2" :value="t2">
                  {{ t2 }}
                </option>
              </select>
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
              <select v-model="draftTrigger.scope">
                <option v-for="s in (['all','powershell','cmd','wsl'] as TriggerScope[])" :key="s" :value="s">
                  {{ s }}
                </option>
              </select>
            </label>
          </div>
          <div class="row-2">
            <label class="field">
              <span>{{ t('triggers.field.action') }}</span>
              <select v-model="draftTrigger.action.kind">
                <option v-for="k in (['toast','sendToAi','runSnippet','capture'] as TriggerActionKind[])" :key="k" :value="k">
                  {{ t(`triggers.action.${k}`) }}
                </option>
              </select>
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

      <section v-if="tab === 'shortcuts'" class="section">
        <p class="note">{{ t('settings.shortcuts.title') }}</p>
        <p class="note">v1.0.5 — {{ t('common.loading') }}</p>
      </section>
    </article>
  </dialog>
</template>

<style scoped>
.dialog {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  padding: 0;
  z-index: 100;
}
.dialog__panel {
  background: var(--color-bg);
  border: 1px solid rgba(255, 255, 255, 0.08);
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
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.dialog__header h2 { margin: 0; font-size: 16px; flex: 1; }
.close { background: transparent; border: none; color: var(--color-fg); cursor: pointer; font-size: 22px; line-height: 1; }
.tabs {
  display: flex;
  gap: 4px;
  padding: 8px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
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
  background: rgba(255, 255, 255, 0.05);
  opacity: 1;
  color: var(--color-accent);
}
.section { padding: 20px; display: flex; flex-direction: column; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field.row { flex-direction: row; align-items: center; gap: 8px; }
.field span { font-size: 12px; opacity: 0.8; }
.field small { font-size: 11px; opacity: 0.5; }
.field input, .field select {
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-fg);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  padding: 6px 8px;
  font-family: inherit;
}
.font-preview {
  margin-top: 6px;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.4);
  border-left: 2px solid var(--color-accent);
  color: var(--color-fg);
  font-size: 12px;
  font-feature-settings: 'liga', 'calt';
  white-space: nowrap;
  overflow-x: auto;
}
.note { font-size: 12px; opacity: 0.6; margin: 0; }
.provider { padding: 12px; background: rgba(255, 255, 255, 0.02); border-radius: 6px; }
.provider__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.badge {
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  opacity: 0.8;
}
.badge.ok {
  background: rgba(0, 200, 0, 0.12);
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
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--color-fg);
  padding: 6px 8px;
  border-radius: 4px;
  font-family: var(--font-family);
}
.primary {
  background: var(--color-accent);
  color: var(--color-bg);
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  font-weight: 600;
  cursor: pointer;
}
.ghost {
  background: transparent;
  color: var(--color-fg);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
}
.ghost.danger { color: var(--color-red); border-color: rgba(255, 95, 87, 0.3); }
.ghost.danger:hover { background: rgba(255, 95, 87, 0.1); border-color: var(--color-red); }

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
  background: rgba(255, 255, 255, 0.02);
  border-radius: 4px;
}
.trigger-row.is-disabled { opacity: 0.5; }
.trigger-row__info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.trigger-row__info strong { font-size: 12px; }
.trigger-row__info code {
  font-family: var(--font-family);
  font-size: 10px;
  color: var(--color-accent);
  background: rgba(0, 0, 0, 0.3);
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
  border: 1px solid rgba(255, 255, 255, 0.08);
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
.field textarea {
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-fg);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  padding: 6px 8px;
  font-family: inherit;
  resize: vertical;
}
</style>
