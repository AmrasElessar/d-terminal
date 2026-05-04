<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { LeafNode } from '@/types/pane';
import type { ChatMessage, AIModel } from '@/types/ai';
import { useAIStore } from '@/stores/ai';
import { formatError } from '@/utils/error';

const props = defineProps<{ leaf: LeafNode }>();
const { t } = useI18n();
const ai = useAIStore();

const messages = ref<ChatMessage[]>([]);
const input = ref('');
const streaming = ref(false);
const error = ref<string | null>(null);
const models = ref<AIModel[]>([]);
const scrollContainer = ref<HTMLDivElement>();

let abort: AbortController | null = null;

const hasProvider = computed(() => ai.activeProvider !== null);

async function refreshModels() {
  models.value = [];
  const provider = await ai.resolveProvider();
  if (!provider) return;
  models.value = await provider.models();
  if (!ai.activeModel && models.value.length > 0) {
    ai.setActiveModel(models.value[0]!.id);
  }
}

async function send() {
  const text = input.value.trim();
  if (!text || streaming.value) return;
  const provider = await ai.resolveProvider();
  if (!provider || !ai.activeModel) {
    error.value = t('ai.noProvider');
    return;
  }
  error.value = null;
  messages.value.push({ role: 'user', content: text });
  messages.value.push({
    role: 'assistant',
    content: '',
    model: ai.activeModel ?? undefined,
    provider: provider.id,
  });
  input.value = '';
  scrollToBottom(true); // user gönderdi — her zaman alta in

  streaming.value = true;
  abort = new AbortController();
  try {
    let acc = '';
    for await (const chunk of provider.chat(messages.value.slice(0, -1), {
      model: ai.activeModel,
      signal: abort.signal,
    })) {
      acc += chunk;
      const last = messages.value[messages.value.length - 1];
      if (last) last.content = acc;
      scrollToBottom();
    }
  } catch (e: unknown) {
    if ((e as Error).name === 'AbortError') {
      // kullanıcı iptal etti — sonuncu mesajı kaldır
      messages.value.pop();
    } else {
      const msg = formatError(e);
      error.value = t('ai.errors.apiFailed', { message: msg });
      messages.value.pop();
    }
  } finally {
    streaming.value = false;
    abort = null;
  }
}

function cancel() {
  abort?.abort();
}

function clearAll() {
  messages.value = [];
  error.value = null;
}

/** Smart auto-scroll: kullanıcı scrollback içine girdiyse otomatik scroll
 *  yapma — okuma akışını bozmasın. Sadece "yapışkan altta" olduğunda alta in.
 *  RAF coalescing: stream chunk'ları tek frame içinde çağrı yığabilir; rAF
 *  her frame'de en fazla bir layout/paint tetikler (debounce yerine native
 *  back-pressure). */
const SCROLL_STICKY_PX = 32;
let scrollPending = false;

function isPinnedToBottom(): boolean {
  const el = scrollContainer.value;
  if (!el) return true;
  return el.scrollHeight - el.clientHeight - el.scrollTop <= SCROLL_STICKY_PX;
}

function scrollToBottom(force = false) {
  const el = scrollContainer.value;
  if (!el) return;
  if (!force && !isPinnedToBottom()) return;
  if (scrollPending) return;
  scrollPending = true;
  requestAnimationFrame(() => {
    scrollPending = false;
    if (scrollContainer.value) {
      scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight;
    }
  });
}

function onSubmit(e: Event) {
  e.preventDefault();
  send();
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
}

onMounted(async () => {
  await refreshModels();
  // Bekleyen prompt varsa input'a koy (BlockPanel/trigger sendToAi tetikledi)
  const queued = ai.consumePrompt();
  if (queued) {
    input.value = queued;
    nextTick(() => scrollToBottom(true));
  }
});
watch(() => ai.activeProvider, refreshModels);
// Pane mount'tan sonra başka bir yerden prompt enjekte edilirse input'u güncelle.
watch(() => ai.pendingPrompt, (next) => {
  if (next) {
    input.value = next;
    ai.consumePrompt();
  }
});

// keep leaf state in sync (light persistence — full session save uses different path)
watch(messages, () => {
  // konuşma uzun olabilir; sadece son 100'ü tut
  // (ileride leaf.state'e yazılacak)
}, { deep: true });

void props.leaf; // ileride leaf.state restore burada
</script>

<template>
  <div class="ai-pane">
    <div v-if="!hasProvider" class="ai-pane__empty">
      <p>{{ t('ai.noProvider') }}</p>
    </div>
    <template v-else>
      <header class="ai-pane__toolbar">
        <select v-model="ai.activeProvider" :aria-label="t('ai.selectProvider')">
          <option
            v-for="(status, id) in ai.statuses"
            :key="id"
            :value="id"
            :disabled="!status.hasKey"
          >
            {{ t(`ai.provider.${id}`) }}
          </option>
        </select>
        <select v-model="ai.activeModel" :aria-label="t('ai.selectModel')">
          <option v-for="m in models" :key="m.id" :value="m.id">{{ m.label }}</option>
        </select>
        <button type="button" class="link" :title="t('ai.clearHistory')" @click="clearAll">
          {{ t('ai.clearHistory') }}
        </button>
      </header>

      <div ref="scrollContainer" class="ai-pane__messages">
        <article v-for="(m, idx) in messages" :key="idx" class="msg" :class="`msg--${m.role}`">
          <div class="msg__role">
            <template v-if="m.role === 'assistant' && m.model">
              <span class="msg__model">{{ m.model }}</span>
              <span v-if="m.provider" class="msg__provider">· {{ m.provider }}</span>
            </template>
            <template v-else>{{ t(`ai.messageRole.${m.role}`) }}</template>
          </div>
          <pre class="msg__content">{{ m.content || (streaming && idx === messages.length - 1 ? t('ai.thinking') : '') }}</pre>
        </article>
        <p v-if="error" class="msg__error">{{ error }}</p>
      </div>

      <form class="ai-pane__input" @submit="onSubmit">
        <textarea
          v-model="input"
          :placeholder="t('ai.placeholder')"
          rows="3"
          :disabled="streaming"
          @keydown="onKeyDown"
        />
        <div class="ai-pane__actions">
          <button v-if="!streaming" type="submit" :disabled="!input.trim()">
            {{ t('ai.send') }}
          </button>
          <button v-else type="button" class="cancel" @click="cancel">
            {{ t('ai.cancel') }}
          </button>
        </div>
      </form>
    </template>
  </div>
</template>

<style scoped>
.ai-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  /* Transparent — pencere şeffaflığı (Mica/Acrylic) bu pane'den de görünür */
  background: transparent;
  color: var(--color-fg);
}
.ai-pane__empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-fg);
  opacity: 0.6;
  padding: 20px;
  text-align: center;
}
.ai-pane__toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 12px;
}
.ai-pane__toolbar select {
  background: var(--color-bg);
  color: var(--color-fg);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 4px 8px;
  border-radius: 4px;
  font-family: inherit;
}
.ai-pane__toolbar .link {
  background: transparent;
  border: none;
  color: var(--color-accent);
  cursor: pointer;
  margin-left: auto;
  font-size: 12px;
}
.ai-pane__messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}
.msg {
  margin-bottom: 16px;
}
.msg__role {
  font-size: 11px;
  text-transform: lowercase;
  letter-spacing: 0;
  opacity: 0.85;
  margin-bottom: 4px;
  display: flex;
  gap: 6px;
  align-items: baseline;
}
.msg--user .msg__role {
  color: var(--color-accent);
}
.msg--assistant .msg__role {
  color: var(--color-accent2);
}
.msg__model {
  font-weight: 600;
}
.msg__provider {
  font-size: 10px;
  opacity: 0.6;
  font-weight: 400;
}
.msg__content {
  margin: 0;
  white-space: pre-wrap;
  font-family: var(--font-family);
  font-size: 13px;
  line-height: 1.5;
}
.msg__error {
  color: var(--color-red);
  font-size: 12px;
  margin: 8px 0;
}
.ai-pane__input {
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ai-pane__input textarea {
  background: var(--color-bg);
  color: var(--color-fg);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 8px;
  font-family: var(--font-family);
  font-size: 13px;
  resize: vertical;
  min-height: 60px;
}
.ai-pane__input textarea:focus {
  outline: none;
  border-color: var(--color-accent);
}
.ai-pane__actions {
  display: flex;
  justify-content: flex-end;
}
.ai-pane__actions button {
  background: var(--color-accent);
  color: var(--color-bg);
  border: none;
  padding: 6px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 600;
}
.ai-pane__actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ai-pane__actions .cancel {
  background: var(--color-red);
}
</style>
