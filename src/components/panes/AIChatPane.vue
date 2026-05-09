<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { LeafNode } from '@/types/pane';
import type { ChatMessage, AIModel } from '@/types/ai';
import { useAIStore } from '@/stores/ai';
import { useAIUsageStore } from '@/stores/aiUsage';
import { useChatsStore } from '@/stores/chats';
import { formatError } from '@/utils/error';
import DarkSelect, { type DarkSelectOption } from '@/components/ui/DarkSelect.vue';
import type { ProviderId } from '@/types/ai';
import { estimateCost, formatUsageBadge, sumUsage } from '@/types/aiPricing';
import { getProvider } from '@/providers/registry';

const props = defineProps<{ leaf: LeafNode }>();
const { t } = useI18n();
const ai = useAIStore();
const aiUsage = useAIUsageStore();
const chats = useChatsStore();

// Pane'e bağlı kalıcı mesaj listesi — pane unmount'ta veri kaybolmaz, sadece
// pane kalıcı silinince (closePane/closeTab/loadWorkspace) chats.clearPane ile
// boşaltılır. Component remount'tan etkilenmez (split tree restructure, tab
// değişimi vb.).
const messages = chats.ensure(props.leaf.id);
const input = ref('');
const streaming = ref(false);
const error = ref<string | null>(null);
const models = ref<AIModel[]>([]);
const scrollContainer = ref<HTMLDivElement>();

let abort: AbortController | null = null;

const hasProvider = computed(() => ai.activeProvider !== null);

// --- Beyin fırtınası modu ---
// Birden fazla AI'a aynı soruyu paralel sor. Hard limit 3 — token uçmasın.
// Round limit 1 (AI'lar birbirini görmez); tartışma istenirse Faz 4'te açılır.
const BRAINSTORM_MAX = 3;
const brainstormMode = ref(false);
const brainstormPicks = reactive(new Set<ProviderId>());

const activeProviderIds = computed<ProviderId[]>(() =>
  (Object.values(ai.statuses) as Array<{ id: ProviderId; hasKey: boolean }>)
    .filter((s) => s.hasKey)
    .map((s) => s.id),
);

const canBrainstorm = computed(() => activeProviderIds.value.length >= 2);

interface BrainstormChip {
  id: ProviderId;
  label: string;
  picked: boolean;
}
const brainstormChips = computed<BrainstormChip[]>(() =>
  activeProviderIds.value.map((id) => ({
    id,
    label: t(`ai.provider.${id}`),
    picked: brainstormPicks.has(id),
  })),
);

function toggleBrainstormPick(id: ProviderId) {
  if (brainstormPicks.has(id)) {
    brainstormPicks.delete(id);
    return;
  }
  if (brainstormPicks.size >= BRAINSTORM_MAX) {
    error.value = t('ai.brainstorm.limitReached', { max: BRAINSTORM_MAX });
    return;
  }
  brainstormPicks.add(id);
}

function toggleBrainstormMode() {
  if (!canBrainstorm.value) return;
  brainstormMode.value = !brainstormMode.value;
  if (brainstormMode.value && brainstormPicks.size === 0) {
    // İlk açılışta aktif olanların ilk MAX kadarını seç
    for (const id of activeProviderIds.value.slice(0, BRAINSTORM_MAX)) {
      brainstormPicks.add(id);
    }
  }
}

const providerOptions = computed<DarkSelectOption[]>(() =>
  Object.entries(ai.statuses).map(([id, status]) => ({
    value: id,
    label: t(`ai.provider.${id}`),
    disabled: !status.hasKey,
  })),
);

const modelOptions = computed<DarkSelectOption[]>(() =>
  models.value.map((m) => ({ value: m.id, label: m.label })),
);

function onProviderPick(v: string) {
  ai.activeProvider = v as ProviderId;
}
function onModelPick(v: string) {
  ai.setActiveModel(v);
}

async function refreshModels() {
  models.value = [];
  const provider = await ai.resolveProvider();
  if (!provider) return;
  models.value = await provider.models();
  if (!ai.activeModel && models.value.length > 0) {
    ai.setActiveModel(models.value[0]!.id);
  }
}

/** Tek provider için stream — kendi assistant mesajına yazar, usage hesaplar.
 *  Brainstorm modunda paralel olarak birden çok kez çağrılır. */
async function streamInto(
  msgIdx: number,
  providerId: ProviderId,
  modelId: string,
  priorContext: ChatMessage[],
  signal: AbortSignal,
) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`provider çözülemedi: ${providerId}`);
  let acc = '';
  for await (const chunk of provider.chat(priorContext, { model: modelId, signal })) {
    acc += chunk;
    const m = messages.value[msgIdx];
    if (m) m.content = acc;
    scrollToBottom();
  }
  const m = messages.value[msgIdx];
  if (m) {
    const inputText = priorContext.map((x) => x.content).join('\n');
    const u = estimateCost(providerId, modelId, inputText, acc);
    m.usage = u;
    aiUsage.recordEstimate(providerId, modelId, props.leaf.id, u, brainstormMode.value);
  }
}

async function send() {
  const text = input.value.trim();
  if (!text || streaming.value) return;
  error.value = null;
  abort = new AbortController();

  // --- Beyin fırtınası modu: paralel multi-AI ---
  if (brainstormMode.value) {
    const picks = [...brainstormPicks];
    if (picks.length === 0) {
      error.value = t('ai.brainstorm.pickAtLeastOne');
      return;
    }
    // Her provider için varsayılan model — provider.models()[0]
    const resolved: { id: ProviderId; model: string }[] = [];
    for (const id of picks) {
      const p = getProvider(id);
      if (!p) continue;
      const list = await p.models();
      const m = list[0]?.id;
      if (m) resolved.push({ id, model: m });
    }
    if (resolved.length === 0) {
      error.value = t('ai.errors.modelMissing', { model: '?' });
      return;
    }

    messages.value.push({ role: 'user', content: text });
    const userMsgIdx = messages.value.length - 1;
    // Her provider için bir assistant placeholder
    const startIdxes: number[] = [];
    for (const r of resolved) {
      messages.value.push({
        role: 'assistant',
        content: '',
        model: r.model,
        provider: r.id,
      });
      startIdxes.push(messages.value.length - 1);
    }
    input.value = '';
    scrollToBottom(true);

    // Brainstorm context: her AI önceki kullanıcı + kendi geçmiş asistan mesajlarını görsün,
    // diğer AI'ların paralel cevaplarını GÖRMESİN (round limit 1).
    const priorBase = messages.value.slice(0, userMsgIdx + 1).filter(
      (m) => m.role === 'user' || m.role === 'system',
    );

    streaming.value = true;
    try {
      await Promise.all(
        resolved.map((r, i) =>
          streamInto(startIdxes[i]!, r.id, r.model, priorBase, abort!.signal).catch((e) => {
            if ((e as Error).name !== 'AbortError') {
              const msg = formatError(e);
              const m = messages.value[startIdxes[i]!];
              if (m) m.content = `[${t('common.error')}] ${msg}`;
            }
          }),
        ),
      );
    } finally {
      streaming.value = false;
      abort = null;
    }
    return;
  }

  // --- Tekli mod (default) ---
  const provider = await ai.resolveProvider();
  if (!provider || !ai.activeModel) {
    error.value = t('ai.noProvider');
    return;
  }
  messages.value.push({ role: 'user', content: text });
  messages.value.push({
    role: 'assistant',
    content: '',
    model: ai.activeModel ?? undefined,
    provider: provider.id,
  });
  input.value = '';
  scrollToBottom(true);
  streaming.value = true;
  try {
    const priorMessages = messages.value.slice(0, -1);
    await streamInto(
      messages.value.length - 1,
      provider.id,
      ai.activeModel,
      priorMessages,
      abort.signal,
    );
  } catch (e: unknown) {
    if ((e as Error).name === 'AbortError') {
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

/** Pane footer için: tüm assistant mesajlarının toplam usage'ı. */
const sessionUsage = computed(() =>
  sumUsage(
    messages.value.flatMap((m) => (m.role === 'assistant' && m.usage ? [m.usage] : [])),
  ),
);
const sessionBadge = computed(() =>
  sessionUsage.value.inputTokens + sessionUsage.value.outputTokens > 0
    ? formatUsageBadge(sessionUsage.value)
    : '',
);

function badgeOf(m: ChatMessage): string {
  return m.usage ? formatUsageBadge(m.usage) : '';
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
        <template v-if="!brainstormMode">
          <DarkSelect
            width="auto"
            :model-value="ai.activeProvider ?? ''"
            :options="providerOptions"
            :aria-label="t('ai.selectProvider')"
            @update:model-value="onProviderPick"
          />
          <DarkSelect
            width="auto"
            :model-value="ai.activeModel ?? ''"
            :options="modelOptions"
            :aria-label="t('ai.selectModel')"
            @update:model-value="onModelPick"
          />
        </template>
        <template v-else>
          <span class="ai-pane__bsLabel">{{ t('ai.brainstorm.pickAIs', { max: BRAINSTORM_MAX }) }}</span>
          <label
            v-for="chip in brainstormChips"
            :key="chip.id"
            class="ai-pane__chip"
            :class="{ 'ai-pane__chip--on': chip.picked }"
          >
            <input type="checkbox" :checked="chip.picked" @change="toggleBrainstormPick(chip.id)" />
            <span>{{ chip.label }}</span>
          </label>
        </template>
        <button
          type="button"
          class="ai-pane__bsToggle"
          :class="{ 'ai-pane__bsToggle--on': brainstormMode }"
          :disabled="!canBrainstorm"
          :title="canBrainstorm ? t('ai.brainstorm.toggle', { max: BRAINSTORM_MAX }) : t('ai.brainstorm.needTwo')"
          @click="toggleBrainstormMode"
        >
          🌪️ {{ t('ai.brainstorm.short') }}
        </button>
        <button type="button" class="link" :title="t('ai.clearHistory')" @click="clearAll">
          {{ t('ai.clearHistory') }}
        </button>
      </header>

      <div ref="scrollContainer" class="ai-pane__messages" aria-live="polite" aria-atomic="false">
        <article v-for="(m, idx) in messages" :key="idx" class="msg" :class="`msg--${m.role}`">
          <div class="msg__role">
            <template v-if="m.role === 'assistant' && m.model">
              <span class="msg__model">{{ m.model }}</span>
              <span v-if="m.provider" class="msg__provider">· {{ m.provider }}</span>
            </template>
            <template v-else>{{ t(`ai.messageRole.${m.role}`) }}</template>
          </div>
          <pre class="msg__content">{{ m.content || (streaming && idx === messages.length - 1 ? t('ai.thinking') : '') }}</pre>
          <div v-if="m.role === 'assistant' && m.usage" class="msg__usage" :title="t('ai.usage.heuristicNote')">
            {{ badgeOf(m) }}
          </div>
        </article>
        <p v-if="error" class="msg__error">{{ error }}</p>
      </div>

      <footer v-if="sessionBadge" class="ai-pane__usage" :title="t('ai.usage.heuristicNote')">
        <span class="ai-pane__usage-label">{{ t('ai.usage.session') }}:</span>
        <span class="ai-pane__usage-value">{{ sessionBadge }}</span>
      </footer>

      <form class="ai-pane__input" @submit="onSubmit">
        <textarea
          v-model="input"
          :placeholder="t('ai.placeholder')"
          rows="2"
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
  border-bottom: 1px solid color-mix(in srgb, var(--color-fg) 5%, transparent);
  font-size: 12px;
}
.ai-pane__toolbar select {
  background: var(--color-bg);
  color: var(--color-fg);
  border: 1px solid color-mix(in srgb, var(--color-fg) 10%, transparent);
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
.msg__usage {
  margin-top: 4px;
  font-size: 10px;
  opacity: 0.5;
  font-family: var(--font-family);
  letter-spacing: 0.02em;
}
.ai-pane__usage {
  display: flex;
  gap: 6px;
  padding: 4px 12px;
  border-top: 1px solid color-mix(in srgb, var(--color-fg) 5%, transparent);
  font-size: 11px;
  opacity: 0.7;
}
.ai-pane__usage-label {
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 10px;
}
.ai-pane__usage-value {
  font-family: var(--font-family);
  color: var(--color-accent);
}
.ai-pane__bsLabel {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.7;
}
.ai-pane__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: 12px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--color-fg) 4%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-fg) 12%, transparent);
  cursor: pointer;
  user-select: none;
}
.ai-pane__chip--on {
  background: color-mix(in srgb, var(--color-accent) 18%, transparent);
  border-color: var(--color-accent);
}
.ai-pane__chip input { display: none; }
.ai-pane__bsToggle {
  background: transparent;
  color: var(--color-fg);
  border: 1px solid color-mix(in srgb, var(--color-fg) 14%, transparent);
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  margin-left: auto;
}
.ai-pane__bsToggle:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-fg) 6%, transparent);
}
.ai-pane__bsToggle--on {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.ai-pane__bsToggle:disabled { opacity: 0.4; cursor: not-allowed; }
.ai-pane__input {
  border-top: 1px solid color-mix(in srgb, var(--color-fg) 5%, transparent);
  padding: 6px 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  /* Pane'i ASLA üst yarıdan büyük tutma — uzun mesaj yazılırken bile mesaj
     listesi kabul edilebilir kalsın. */
  flex-shrink: 0;
  max-height: 50%;
}
.ai-pane__input textarea {
  background: var(--color-bg);
  color: var(--color-fg);
  border: 1px solid color-mix(in srgb, var(--color-fg) 10%, transparent);
  border-radius: 6px;
  padding: 6px 8px;
  font-family: var(--font-family);
  font-size: 13px;
  resize: vertical;
  min-height: 42px;
  max-height: 200px;
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
