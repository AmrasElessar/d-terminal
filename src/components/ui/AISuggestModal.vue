<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { suggestCommand } from '@/composables/useAISuggestion';
import { usePanesStore } from '@/stores/panes';
import { useAIStore } from '@/stores/ai';
import { useToastsStore } from '@/stores/toasts';
import { api } from '@/api/tauri';
import type { PaneType } from '@/types/pane';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const panes = usePanesStore();
const ai = useAIStore();
const toasts = useToastsStore();

const prompt = ref('');
const generated = ref('');
const isGenerating = ref(false);
const errorMsg = ref<string | null>(null);
const promptInput = ref<HTMLInputElement>();

let aborter: AbortController | null = null;

const focusedPane = computed(() => panes.focused);
const targetType = computed<PaneType>(() => focusedPane.value?.type ?? 'powershell');
const canExecute = computed(() => !!focusedPane.value?.ptyId && generated.value.length > 0);

watch(
  () => props.open,
  (open) => {
    if (open) {
      reset();
      nextTick(() => promptInput.value?.focus());
    } else {
      aborter?.abort();
    }
  },
);

function reset() {
  prompt.value = '';
  generated.value = '';
  isGenerating.value = false;
  errorMsg.value = null;
}

async function generate() {
  if (!prompt.value.trim()) return;
  if (!ai.activeProvider) {
    errorMsg.value = t('ai.noProvider');
    return;
  }
  errorMsg.value = null;
  isGenerating.value = true;
  generated.value = '';
  aborter?.abort();
  aborter = new AbortController();
  try {
    const result = await suggestCommand({
      prompt: prompt.value.trim(),
      paneType: targetType.value,
      signal: aborter.signal,
    });
    generated.value = result;
  } catch (e: unknown) {
    const { formatError } = await import('@/utils/error');
    const msg = formatError(e);
    errorMsg.value = msg === 'no-provider'
      ? t('ai.noProvider')
      : t('ai.suggest.failed', { message: msg });
  } finally {
    isGenerating.value = false;
  }
}

/** Önerilen komutu aktif terminal pane'e yapıştır (Enter göndermeden — kullanıcı denetler). */
async function insertIntoTerminal(execute: boolean) {
  const leaf = focusedPane.value;
  if (!leaf?.ptyId) {
    toasts.warning(t('ai.suggest.noTerminal'));
    return;
  }
  let text = generated.value;
  if (execute) text += '\r';
  await api.ptyWrite(leaf.ptyId, new TextEncoder().encode(text));
  emit('close');
}

function onPromptKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    generate();
  } else if (e.key === 'Escape') {
    emit('close');
  }
}

function onResultKey(e: KeyboardEvent) {
  if (e.key === 'Tab') {
    e.preventDefault();
    insertIntoTerminal(false);
  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    insertIntoTerminal(true);
  } else if (e.key === 'Escape') {
    emit('close');
  }
}
</script>

<template>
  <dialog v-if="open" class="dialog" open @click.self="emit('close')">
    <article class="panel" @keydown.stop>
      <header class="panel__head">
        <span class="panel__icon">✨</span>
        <h2>{{ t('ai.suggest.title') }}</h2>
        <span class="panel__shell">{{ t(`pane.type.${targetType}`) }}</span>
        <button type="button" class="close" @click="emit('close')">×</button>
      </header>

      <div class="panel__body">
        <label class="field">
          <span>{{ t('ai.suggest.promptLabel') }}</span>
          <input
            ref="promptInput"
            v-model="prompt"
            type="text"
            class="prompt-input"
            :placeholder="t('ai.suggest.promptPh')"
            spellcheck="false"
            @keydown="onPromptKey"
          />
        </label>

        <div v-if="isGenerating" class="status">
          <span class="spinner">◌</span> {{ t('ai.thinking') }}
        </div>

        <p v-if="errorMsg" class="error">{{ errorMsg }}</p>

        <label v-if="generated || isGenerating" class="field">
          <span>{{ t('ai.suggest.commandLabel') }}</span>
          <textarea
            v-model="generated"
            class="result"
            rows="3"
            spellcheck="false"
            @keydown="onResultKey"
          />
        </label>

        <div class="actions">
          <button
            type="button"
            class="primary"
            :disabled="!prompt.trim() || isGenerating"
            @click="generate"
          >
            ↻ {{ t('ai.suggest.generate') }}
          </button>
          <button
            type="button"
            class="ghost"
            :disabled="!canExecute"
            :title="t('ai.suggest.insertHint')"
            @click="insertIntoTerminal(false)"
          >
            ⇥ {{ t('ai.suggest.insert') }}
          </button>
          <button
            type="button"
            class="primary go"
            :disabled="!canExecute"
            :title="t('ai.suggest.executeHint')"
            @click="insertIntoTerminal(true)"
          >
            ⏎ {{ t('ai.suggest.execute') }}
          </button>
        </div>

        <p class="hint">{{ t('ai.suggest.hint') }}</p>
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
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  border: none;
  padding: 60px 0 0 0;
  z-index: 110;
}
.panel {
  background: var(--color-bg);
  border: 1px solid var(--color-accent);
  border-radius: 6px;
  width: min(640px, 90vw);
  color: var(--color-fg);
  box-shadow: 0 12px 48px var(--color-overlay-dark), 0 0 0 1px var(--color-accent-soft-15);
}
.panel__head {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  gap: 10px;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-line);
}
.panel__head h2 {
  margin: 0;
  font-size: 13px;
  color: var(--color-accent);
}
.panel__icon { font-size: 16px; }
.panel__shell {
  font-size: 10px;
  color: var(--color-dim);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: color-mix(in srgb, var(--color-fg) 4%, transparent);
  padding: 2px 6px;
  border-radius: 2px;
}
.close { background: transparent; border: none; color: var(--color-fg); cursor: pointer; font-size: 18px; }
.panel__body { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field span { font-size: 11px; color: var(--color-dim); }
.prompt-input {
  background: var(--color-overlay-light);
  color: var(--color-fg);
  border: 1px solid var(--color-line);
  border-radius: 4px;
  padding: 8px 10px;
  font-family: var(--font-family);
  font-size: 13px;
  outline: none;
}
.prompt-input:focus { border-color: var(--color-accent); }
.result {
  background: var(--color-overlay-medium);
  color: var(--color-accent);
  border: 1px solid var(--color-accent);
  border-radius: 4px;
  padding: 8px 10px;
  font-family: var(--font-family);
  font-size: 12px;
  outline: none;
  resize: vertical;
  white-space: pre-wrap;
  word-break: break-all;
}
.status {
  font-size: 11px;
  color: var(--color-dim);
}
.spinner { color: var(--color-accent); animation: spin 1.2s linear infinite; display: inline-block; }
@keyframes spin { 100% { transform: rotate(360deg); } }
.error {
  margin: 0;
  font-size: 11px;
  color: var(--color-red);
  padding: 6px 8px;
  background: var(--color-red-soft-08);
  border-left: 2px solid var(--color-red);
}
.actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.primary {
  background: var(--color-accent);
  color: var(--color-bg);
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  font-weight: 600;
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
}
.primary.go { background: var(--color-green, #28C840); }
.primary:disabled { opacity: 0.4; cursor: not-allowed; }
.ghost {
  background: transparent;
  color: var(--color-fg);
  border: 1px solid var(--color-line);
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
}
.ghost:disabled { opacity: 0.4; cursor: not-allowed; }
.hint {
  margin: 0;
  font-size: 10px;
  color: var(--color-dim);
}
</style>
