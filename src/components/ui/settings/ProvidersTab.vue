<script setup lang="ts">
// Ayarlar → AI sağlayıcıları: bulut anahtarları (DPAPI vault), yerel
// runtime'lar, özel OpenAI-uyumlu endpoint.
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '@/stores/settings';
import { useAIStore } from '@/stores/ai';
import { useToastsStore } from '@/stores/toasts';
import { ALL_PROVIDER_IDS } from '@/providers/registry';
import { PROVIDER_CATEGORY, type ProviderId } from '@/types/ai';
import { localizeError } from '@/utils/error';

const { t } = useI18n();
const settings = useSettingsStore();
const ai = useAIStore();
const toasts = useToastsStore();

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
const newKey = ref<Record<ProviderId, string>>({} as Record<ProviderId, string>);

async function saveKey(id: ProviderId) {
  const key = newKey.value[id]?.trim();
  if (!key) return;
  try {
    await ai.setKey(id, key);
    newKey.value[id] = '';
    toasts.success(t('settings.saved'), 1500);
  } catch (e) {
    toasts.error(localizeError(e, t));
  }
}

async function deleteKey(id: ProviderId) {
  try {
    await ai.removeKey(id);
  } catch (e) {
    toasts.error(localizeError(e, t));
  }
}
</script>

<template>
  <section class="section">
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
</template>

<style scoped src="./settings.css"></style>
