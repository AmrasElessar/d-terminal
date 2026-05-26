<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { PaneType } from '@/types/pane';
import { useProfilesStore } from '@/stores/profiles';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  close: [];
  create: [type: PaneType, profileId?: string];
}>();

const { t } = useI18n();
const profiles = useProfilesStore();

// agentView dahil — kullanıcı auto-split olmadan manuel olarak da "tüm
// agent'lar" görünümünü açabilsin. Source pane belirsiz olduğunda AgentViewPane
// "global" moda düşer (bkz. AgentViewPane.vue).
const SPECIAL_TYPES: PaneType[] = ['aiChat', 'logStream', 'agentView'];

const SPECIAL_ICONS: Record<string, string> = {
  aiChat: '✨',
  logStream: '📜',
  agentView: '👁',
};
const selectedProfileId = ref<string | null>(null);
const selectedSpecialType = ref<PaneType | null>(null);

const allProfiles = computed(() => profiles.all);

watch(() => props.open, (open) => {
  if (open && !selectedProfileId.value && !selectedSpecialType.value) {
    const first = allProfiles.value[0];
    if (first) selectedProfileId.value = first.id;
  }
});

function selectProfile(id: string) {
  selectedProfileId.value = id;
  selectedSpecialType.value = null;
}

function selectSpecial(type: PaneType) {
  selectedSpecialType.value = type;
  selectedProfileId.value = null;
}

function create() {
  if (selectedSpecialType.value) {
    emit('create', selectedSpecialType.value);
    return;
  }
  if (!selectedProfileId.value) return;
  const profile = profiles.find(selectedProfileId.value);
  if (!profile) return;
  emit('create', profile.paneType, profile.id);
}
</script>

<template>
  <dialog v-if="open" class="dialog" open @click.self="emit('close')">
    <article class="dialog__panel">
      <h2>{{ t('newPane.title') }}</h2>
      <p class="hint">{{ t('newPane.selectType') }}</p>

      <!-- Profile listesi (built-in + kullanıcı) -->
      <h3 class="section-h">{{ t('newPane.profiles') }}</h3>
      <div class="grid">
        <button
          v-for="profile in allProfiles"
          :key="profile.id"
          type="button"
          class="card"
          :class="{ active: selectedProfileId === profile.id }"
          :style="profile.color ? { borderLeftColor: profile.color } : {}"
          @click="selectProfile(profile.id)"
          @dblclick="selectProfile(profile.id); create()"
        >
          <span class="card__icon">{{ profile.icon }}</span>
          <span class="card__name">{{ profile.name }}</span>
          <span v-if="!profile.builtin" class="card__badge">{{ t('newPane.userBadge') }}</span>
        </button>
      </div>

      <!-- AI / Log gibi non-shell tipler -->
      <h3 class="section-h">{{ t('newPane.special') }}</h3>
      <div class="grid">
        <button
          v-for="type in SPECIAL_TYPES"
          :key="type"
          type="button"
          class="card"
          :class="{ active: selectedSpecialType === type }"
          @click="selectSpecial(type)"
          @dblclick="selectSpecial(type); create()"
        >
          <span class="card__icon">{{ SPECIAL_ICONS[type] ?? '•' }}</span>
          <span class="card__name">{{ t(`pane.type.${type}`) }}</span>
        </button>
      </div>

      <div class="actions">
        <button type="button" class="ghost" @click="emit('close')">{{ t('newPane.cancel') }}</button>
        <button type="button" class="primary" :disabled="!selectedProfileId && !selectedSpecialType" @click="create">
          {{ t('newPane.create') }}
        </button>
      </div>
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
  padding: 20px;
  min-width: 480px;
  max-width: 640px;
  max-height: 80vh;
  overflow-y: auto;
  color: var(--color-fg);
}
h2 {
  margin: 0 0 6px 0;
  font-size: 16px;
}
.section-h {
  margin: 12px 0 6px 0;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-dim);
}
.hint {
  margin: 0 0 12px 0;
  font-size: 12px;
  opacity: 0.7;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 6px;
}
.card {
  display: grid;
  grid-template-columns: 24px 1fr auto;
  gap: 8px;
  align-items: center;
  background: color-mix(in srgb, var(--color-fg) 3%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-fg) 8%, transparent);
  border-left: 3px solid color-mix(in srgb, var(--color-fg) 10%, transparent);
  color: var(--color-fg);
  padding: 8px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-family: var(--font-family);
  text-align: left;
  font-size: 11px;
  transition: background 0.1s ease;
}
.card:hover {
  background: color-mix(in srgb, var(--color-fg) 6%, transparent);
}
.card.active {
  border-color: var(--color-accent);
  background: var(--color-accent-soft-12);
  color: var(--color-accent);
}
.card__icon { font-size: 14px; text-align: center; }
.card__name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card__badge {
  font-size: 9px;
  background: color-mix(in srgb, var(--color-fg) 6%, transparent);
  color: var(--color-dim);
  padding: 1px 4px;
  border-radius: 2px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.actions button {
  padding: 6px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  border: 1px solid transparent;
  font-size: 11px;
}
.actions button:disabled { opacity: 0.4; cursor: not-allowed; }
.ghost {
  background: transparent;
  color: var(--color-fg);
  border-color: color-mix(in srgb, var(--color-fg) 10%, transparent);
}
.primary {
  background: var(--color-accent);
  color: var(--color-bg);
  font-weight: 600;
}
</style>
