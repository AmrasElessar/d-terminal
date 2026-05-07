<script setup lang="ts">
// Agent Watch sidebar — TerminalPane'in sağ kenarında slide-in.
// AI tool'ların OSC 9999 ile yaydığı agent event'lerini gösterir.
//
// Layout: header (model dropdown + özet) + agent listesi.
// Her satır: durum noktası, isim, süre, token, cost; click → detay accordion.
// Stop butonu kullanıcıyı parent terminal'e SIGINT göndermesi için emit eder
// (per-agent ayırma yok — terminal tek PTY).

import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAgentWatchStore, knownModelIds } from '@/stores/agentWatch';
import type { AgentInfo, AgentStatus } from '@/types/agent';
import DarkSelect, { type DarkSelectOption } from '@/components/ui/DarkSelect.vue';

const props = defineProps<{ paneId: string }>();
const emit = defineEmits<{
  close: [];
  /** Kullanıcı agent satırındaki Stop butonuna bastı — TerminalPane PTY'ye
   *  SIGINT (\x03) yazması beklenir. Tek terminal/tek PTY: parent CLI tüm
   *  subagent'ları durdurur, "per-agent" durdurma teknik olarak mümkün değil. */
  'stop-agent': [agentId: string];
}>();

const { t } = useI18n();
const watcher = useAgentWatchStore();
const view = watcher.paneView(props.paneId);

const modelOptions = computed<DarkSelectOption[]>(() =>
  knownModelIds().map((id) => ({ value: id, label: id })),
);
function onModelPick(v: string) {
  watcher.setModel(props.paneId, v);
}

const expanded = ref<Set<string>>(new Set());
function toggleExpand(id: string) {
  if (expanded.value.has(id)) expanded.value.delete(id);
  else expanded.value.add(id);
  expanded.value = new Set(expanded.value); // reactivity trigger
}

function statusDot(s: AgentStatus): string {
  switch (s) {
    case 'running': return '●';
    case 'waiting': return '⏸';
    case 'done':    return '✓';
    case 'error':   return '✗';
    case 'aborted': return '–';
  }
}
function statusClass(s: AgentStatus): string {
  return `agent-row__dot--${s}`;
}
function canStop(s: AgentStatus): boolean {
  return s === 'running' || s === 'waiting';
}

function durationText(a: AgentInfo): string {
  const end = a.endedAt ?? Date.now();
  const ms = end - a.startedAt;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function tokensText(a: AgentInfo): string {
  const total = a.inputTokens + a.outputTokens;
  if (total === 0) return '';
  // Compact: 1.2k, 12k, 120k
  if (total < 1000) return `${total} tok`;
  if (total < 100_000) return `${(total / 1000).toFixed(1)}k tok`;
  return `${Math.round(total / 1000)}k tok`;
}

function costText(c: number | null): string {
  if (c === null) return '';
  if (c === 0) return '';
  if (c < 0.001) return '<$0.001';
  if (c < 1)   return `$${c.toFixed(4)}`;
  return `$${c.toFixed(2)}`;
}

const summary = computed(() => {
  const agents = view.value.agents;
  const running = agents.filter((a) => a.status === 'running').length;
  const waiting = agents.filter((a) => a.status === 'waiting').length;
  const done = agents.length - running - waiting;
  const totalTok = agents.reduce((s, a) => s + a.inputTokens + a.outputTokens, 0);
  let totalCost: number | null = 0;
  for (const a of agents) {
    if (a.effectiveCost === null) {
      totalCost = null;
      break;
    }
    if (totalCost !== null) totalCost += a.effectiveCost;
  }
  return { running, waiting, done, total: agents.length, totalTok, totalCost };
});
</script>

<template>
  <aside class="agent-panel" :aria-label="t('agentWatch.title')">
    <header class="agent-panel__head">
      <span class="agent-panel__title">👁 {{ t('agentWatch.title') }}</span>
      <button type="button" class="agent-panel__close" :title="t('common.close')" @click="emit('close')">×</button>
    </header>
    <div class="agent-panel__model-row">
      <span class="agent-panel__model-label">{{ t('agentWatch.model') }}</span>
      <DarkSelect
        width="full"
        :model-value="view.modelId"
        :options="modelOptions"
        @update:model-value="onModelPick"
      />
    </div>
    <div v-if="view.hasAny" class="agent-panel__sum">
      <span v-if="summary.running > 0" class="sum sum--run">● {{ summary.running }}</span>
      <span v-if="summary.waiting > 0" class="sum sum--wait">⏸ {{ summary.waiting }}</span>
      <span v-if="summary.done > 0" class="sum sum--done">✓ {{ summary.done }}</span>
      <span v-if="summary.totalTok > 0" class="sum sum--tok">{{ Math.round(summary.totalTok / 1000) }}k tok</span>
      <span v-if="summary.totalCost !== null && summary.totalCost > 0" class="sum sum--cost">
        ≈ {{ costText(summary.totalCost) }}
      </span>
    </div>

    <div v-if="!view.hasAny" class="agent-panel__empty">
      <p class="agent-panel__empty-title">{{ t('agentWatch.emptyTitle') }}</p>
      <p class="agent-panel__empty-hint">{{ t('agentWatch.emptyHint') }}</p>
      <code class="agent-panel__protocol">\e]9999;{"k":"start","id":"a1","name":"..."}\a</code>
    </div>

    <ul v-else class="agent-list">
      <li
        v-for="a in view.agents"
        :key="a.id"
        class="agent-row"
        :class="{ 'agent-row--expanded': expanded.has(a.id), [`agent-row--${a.status}`]: true }"
      >
        <div class="agent-row__head">
          <button
            type="button"
            class="agent-row__main"
            @click="toggleExpand(a.id)"
          >
            <span class="agent-row__dot" :class="statusClass(a.status)">{{ statusDot(a.status) }}</span>
            <span class="agent-row__name">{{ a.name }}</span>
            <span class="agent-row__meta">
              <span class="agent-row__dur">{{ durationText(a) }}</span>
              <span v-if="tokensText(a)" class="agent-row__tok">{{ tokensText(a) }}</span>
              <span v-if="costText(a.effectiveCost)" class="agent-row__cost">
                {{ costText(a.effectiveCost) }}
              </span>
            </span>
            <span class="agent-row__chev">{{ expanded.has(a.id) ? '▾' : '▸' }}</span>
          </button>
          <button
            v-if="canStop(a.status)"
            type="button"
            class="agent-row__stop"
            :title="t('agentWatch.stopHint')"
            :aria-label="t('agentWatch.stopAgent')"
            @click.stop="emit('stop-agent', a.id)"
          >■</button>
        </div>
        <div v-if="a.status === 'waiting' && a.awaitPrompt" class="agent-row__await">
          ⏸ {{ a.awaitPrompt }}
        </div>
        <div v-if="expanded.has(a.id)" class="agent-row__detail">
          <div v-if="a.parent" class="agent-row__parent">
            ↑ {{ t('agentWatch.subagentOf', { parent: a.parent }) }}
          </div>
          <div v-if="a.error" class="agent-row__error">⚠ {{ a.error }}</div>
          <details v-if="a.thinking.length > 0" class="agent-row__thinking">
            <summary>{{ t('agentWatch.thinkingBlocks', { count: a.thinking.length }) }}</summary>
            <pre v-for="(blk, i) in a.thinking" :key="i" class="agent-row__think-block">{{ blk }}</pre>
          </details>
          <pre v-if="a.output" class="agent-row__output">{{ a.output }}</pre>
        </div>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.agent-panel {
  display: flex;
  flex-direction: column;
  width: 280px;
  min-width: 220px;
  height: 100%;
  background: var(--color-overlay-faint);
  border-left: 1px solid var(--color-line);
  font-family: var(--font-family);
  font-size: 11px;
  color: var(--color-fg);
  overflow: hidden;
}
.agent-panel__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--color-line);
  flex-shrink: 0;
  user-select: none;
}
.agent-panel__title {
  font-weight: 600;
  color: var(--color-accent);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.agent-panel__sum {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--color-line);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.sum {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.sum--run  { color: var(--color-green); }
.sum--wait { color: var(--color-yellow); }
.sum--done { color: var(--color-dim); }
.sum--tok  { color: var(--color-cyan);  margin-left: auto; }
.sum--cost { color: var(--color-yellow); }
.agent-panel__model-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-line);
  font-size: 10px;
}
.agent-panel__model-label {
  color: var(--color-dim);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  flex-shrink: 0;
}
.agent-panel__close {
  background: transparent;
  border: none;
  color: var(--color-dim);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 4px;
}
.agent-panel__close:hover { color: var(--color-fg); }

.agent-panel__empty {
  padding: 12px;
  color: var(--color-dim);
  font-size: 11px;
  line-height: 1.5;
}
.agent-panel__empty-title { color: var(--color-fg); margin: 0 0 6px 0; font-size: 12px; }
.agent-panel__empty-hint  { margin: 0 0 8px 0; }
.agent-panel__protocol {
  display: block;
  background: var(--color-overlay-light);
  border: 1px solid var(--color-line);
  padding: 4px 6px;
  border-radius: 3px;
  font-size: 9.5px;
  word-break: break-all;
  color: var(--color-cyan);
}

.agent-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
}
.agent-row {
  border-bottom: 1px solid var(--color-line);
}
.agent-row__head {
  display: flex;
  align-items: stretch;
}
.agent-row__main {
  flex: 1;
  display: grid;
  grid-template-columns: 14px 1fr auto 14px;
  gap: 6px;
  align-items: center;
  background: transparent;
  border: none;
  color: var(--color-fg);
  cursor: pointer;
  padding: 5px 8px;
  font-family: inherit;
  font-size: inherit;
  text-align: left;
  min-width: 0;
}
.agent-row__main:hover { background: var(--color-accent-soft); }
.agent-row--expanded .agent-row__main { background: var(--color-accent-soft-12); }
.agent-row__stop {
  background: transparent;
  border: none;
  border-left: 1px solid var(--color-line);
  color: var(--color-dim);
  cursor: pointer;
  font-size: 10px;
  padding: 0 8px;
  flex-shrink: 0;
}
.agent-row__stop:hover {
  background: var(--color-red-soft-15);
  color: var(--color-red);
}
.agent-row__dot {
  font-size: 10px;
  text-align: center;
  font-weight: 700;
}
.agent-row__dot--running {
  color: var(--color-green);
  animation: agentRowPulse 1.4s ease-in-out infinite;
}
.agent-row__dot--waiting {
  color: var(--color-yellow);
  animation: agentRowPulse 0.9s ease-in-out infinite;
}
.agent-row__dot--done    { color: var(--color-green); }
.agent-row__dot--error   { color: var(--color-red); }
.agent-row__dot--aborted { color: var(--color-yellow); }
/* Waiting agent satırını sarımtırak banner ile vurgula */
.agent-row--waiting {
  background: color-mix(in srgb, var(--color-yellow) 6%, transparent);
}
.agent-row__await {
  padding: 4px 8px 6px 28px;
  font-size: 10px;
  color: var(--color-yellow);
  font-style: italic;
}
@keyframes agentRowPulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.4; }
}
.agent-row__name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.agent-row__meta {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 9.5px;
  color: var(--color-dim);
  font-variant-numeric: tabular-nums;
}
.agent-row__tok  { color: var(--color-cyan); }
.agent-row__cost { color: var(--color-yellow); }
.agent-row__chev { color: var(--color-dim); font-size: 10px; }

.agent-row__detail {
  padding: 6px 10px 8px 28px;
  background: var(--color-overlay-light);
  font-size: 10.5px;
}
.agent-row__parent {
  color: var(--color-dim);
  font-size: 10px;
  margin-bottom: 4px;
}
.agent-row__error {
  color: var(--color-red);
  background: var(--color-red-soft-08);
  padding: 4px 6px;
  border-radius: 3px;
  margin-bottom: 6px;
}
.agent-row__thinking {
  margin-bottom: 6px;
  font-size: 10px;
}
.agent-row__thinking summary {
  cursor: pointer;
  color: var(--color-accent);
  user-select: none;
}
.agent-row__think-block {
  margin: 4px 0 0 0;
  padding: 4px 6px;
  background: var(--color-overlay-faint);
  border-left: 2px solid var(--color-magenta);
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 9.5px;
  color: var(--color-fg);
  opacity: 0.85;
  max-height: 120px;
  overflow-y: auto;
}
.agent-row__output {
  margin: 0;
  padding: 4px 6px;
  background: var(--color-overlay-faint);
  border-radius: 3px;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 10px;
  max-height: 200px;
  overflow-y: auto;
  color: var(--color-fg);
}
</style>
