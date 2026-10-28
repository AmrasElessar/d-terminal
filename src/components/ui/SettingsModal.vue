<script setup lang="ts">
// Ayarlar modal'ı — kabuk (dialog + sekme gezintisi). Her sekmenin içeriği ve
// mantığı `./settings/*Tab.vue` komponentlerinde (önceden tek 1600 satırlık
// dosya).
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDialogA11y } from '@/composables/useDialogA11y';
import AICostPanel from '@/components/ui/AICostPanel.vue';
import GeneralTab from './settings/GeneralTab.vue';
import AppearanceTab from './settings/AppearanceTab.vue';
import ProvidersTab from './settings/ProvidersTab.vue';
import ProfilesTab from './settings/ProfilesTab.vue';
import TriggersTab from './settings/TriggersTab.vue';
import ShortcutsTab from './settings/ShortcutsTab.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const dialogEl = ref<HTMLElement | null>(null);
useDialogA11y(dialogEl, () => props.open, { onEscape: () => emit('close') });

const { t } = useI18n();

type Tab = 'general' | 'appearance' | 'providers' | 'profiles' | 'triggers' | 'shortcuts' | 'aiCost';
const TABS: Tab[] = ['general', 'appearance', 'providers', 'profiles', 'triggers', 'shortcuts', 'aiCost'];
const tab = ref<Tab>('general');
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
        <button type="button" class="close" :aria-label="t('common.close')" :title="t('common.close')" @click="emit('close')">×</button>
      </header>
      <nav class="tabs" role="tablist">
        <button
          v-for="key in TABS"
          :key="key"
          type="button"
          role="tab"
          :aria-selected="tab === key"
          :class="{ active: tab === key }"
          @click="tab = key"
        >
          {{ t(`settings.tabs.${key}`) }}
        </button>
      </nav>

      <GeneralTab v-if="tab === 'general'" />
      <AppearanceTab v-else-if="tab === 'appearance'" />
      <ProvidersTab v-else-if="tab === 'providers'" />
      <ProfilesTab v-else-if="tab === 'profiles'" />
      <TriggersTab v-else-if="tab === 'triggers'" />
      <ShortcutsTab v-else-if="tab === 'shortcuts'" />
      <section v-else-if="tab === 'aiCost'" class="section">
        <AICostPanel />
      </section>
    </article>
  </dialog>
</template>

<style scoped src="./settings/settings.css"></style>
