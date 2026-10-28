<script setup lang="ts">
// Ayarlar → Shell profilleri (built-in + kullanıcı tanımlı).
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useProfilesStore } from '@/stores/profiles';
import { defaultProfile } from '@/types/profile';
import DarkSelect, { type DarkSelectOption } from '@/components/ui/DarkSelect.vue';

const { t } = useI18n();
const profiles = useProfilesStore();

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

const paneTypeOptions: DarkSelectOption[] = [
  { value: 'powershell', label: 'powershell' },
  { value: 'cmd',        label: 'cmd' },
  { value: 'wsl',        label: 'wsl' },
];
</script>

<template>
  <section class="section">
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
</template>

<style scoped src="./settings.css"></style>
