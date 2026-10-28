<script setup lang="ts">
// Ayarlar → Çıktı trigger'ları (iTerm2 Triggers paritesi).
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useTriggersStore } from '@/stores/triggers';
import { defaultTrigger } from '@/types/trigger';
import DarkSelect, { type DarkSelectOption } from '@/components/ui/DarkSelect.vue';

const { t } = useI18n();
const triggers = useTriggersStore();

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
    allowAutoRun: t.allowAutoRun === true,
  };
  editingTriggerId.value = id;
}

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
</script>

<template>
  <section class="section">
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
      <template v-if="draftTrigger.action.kind === 'runSnippet'">
        <label class="field row">
          <input v-model="draftTrigger.allowAutoRun" type="checkbox" />
          <span>{{ t('triggers.field.allowAutoRun') }}</span>
        </label>
        <small class="note">{{ t('triggers.field.allowAutoRunHint') }}</small>
      </template>
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
</template>

<style scoped src="./settings.css"></style>
