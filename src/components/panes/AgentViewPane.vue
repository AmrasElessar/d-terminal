<script setup lang="ts">
// Agent View pane — auto-split ile açılan, salt-okunur agent stream görüntüsü.
// PTY taşımaz; agentWatch store'undan ilgili agent'ın canlı output'unu
// reaktif olarak render eder. Pane statüsü agent end olduğunda 'exited' olur,
// kullanıcı isterse pane'i kapatabilir veya açık tutup geçmişi inceler.

import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { LeafNode } from '@/types/pane';
import { useAgentWatchStore } from '@/stores/agentWatch';
import { usePanesStore } from '@/stores/panes';
import type { AgentInfo, AgentStatus } from '@/types/agent';

const props = defineProps<{ leaf: LeafNode }>();
const { t } = useI18n();
const watcher = useAgentWatchStore();
const panes = usePanesStore();

/** AgentView leaf'i her zaman agentSourcePaneId + agentId taşır. */
const sourcePaneId = computed(() => props.leaf.agentSourcePaneId ?? '');
const agentId = computed(() => props.leaf.agentId ?? '');

const view = computed(() => watcher.paneView(sourcePaneId.value));
const agent = computed<AgentInfo | null>(() => {
  const a = view.value.value.agents.find((x) => x.id === agentId.value);
  return a ?? null;
});

// Agent end olduğunda pane status'unu sync et — title bar'da "exited" görünür.
watch(
  () => agent.value?.status,
  (s) => {
    if (!s) return;
    if (s === 'done' || s === 'error' || s === 'aborted') {
      panes.setLeafState(props.leaf.id, { status: 'exited' });
    }
  },
);

function statusDot(s: AgentStatus | null | undefined): string {
  switch (s) {
    case 'running': return '●';
    case 'waiting': return '⏸';
    case 'done':    return '✓';
    case 'error':   return '✗';
    case 'aborted': return '–';
    default:        return '○';
  }
}
function statusClass(s: AgentStatus | null | undefined): string {
  return s ? `agent-view__status--${s}` : 'agent-view__status--idle';
}

function durationText(a: AgentInfo): string {
  const end = a.endedAt ?? Date.now();
  const ms = end - a.startedAt;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${sec}s`;
}

function tokensText(a: AgentInfo): string {
  const total = a.inputTokens + a.outputTokens;
  if (total === 0) return '';
  if (total < 1000) return `${total} tok`;
  if (total < 100_000) return `${(total / 1000).toFixed(1)}k tok`;
  return `${Math.round(total / 1000)}k tok`;
}
</script>

<template>
  <div class="agent-view">
    <div v-if="!agent" class="agent-view__empty">
      <p>{{ t('agentView.notFound') }}</p>
      <p class="agent-view__empty-hint">{{ t('agentView.notFoundHint') }}</p>
    </div>
    <template v-else>
      <header class="agent-view__head">
        <span class="agent-view__status" :class="statusClass(agent.status)">{{ statusDot(agent.status) }}</span>
        <span class="agent-view__name">{{ agent.name }}</span>
        <span class="agent-view__meta">
          <span>{{ durationText(agent) }}</span>
          <span v-if="tokensText(agent)">{{ tokensText(agent) }}</span>
        </span>
      </header>
      <div v-if="agent.awaitPrompt" class="agent-view__await">
        ⏸ {{ agent.awaitPrompt }}
      </div>
      <div v-if="agent.error" class="agent-view__error">⚠ {{ agent.error }}</div>
      <details v-if="agent.thinking.length > 0" class="agent-view__thinking">
        <summary>{{ t('agentWatch.thinkingBlocks', { count: agent.thinking.length }) }}</summary>
        <pre v-for="(blk, i) in agent.thinking" :key="i" class="agent-view__think-block">{{ blk }}</pre>
      </details>
      <pre v-if="agent.output" class="agent-view__output">{{ agent.output }}</pre>
      <div v-else class="agent-view__waiting">{{ t('agentView.awaitingOutput') }}</div>
    </template>
  </div>
</template>

<style scoped>
.agent-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: transparent;
  font-family: var(--font-family);
  font-size: 11px;
  color: var(--color-fg);
  overflow: hidden;
}
.agent-view__empty {
  padding: 20px;
  color: var(--color-dim);
  text-align: center;
}
.agent-view__empty-hint { font-size: 10px; opacity: 0.7; margin-top: 6px; }

.agent-view__head {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 6px 10px;
  border-bottom: 1px solid var(--color-line);
  background: var(--color-overlay-faint);
  font-size: 11px;
}
.agent-view__status {
  font-weight: 700;
  font-size: 12px;
  width: 14px;
  text-align: center;
}
.agent-view__status--running {
  color: var(--color-green);
  animation: agentViewPulse 1.4s ease-in-out infinite;
}
.agent-view__status--waiting {
  color: var(--color-yellow);
  animation: agentViewPulse 0.9s ease-in-out infinite;
}
.agent-view__status--done    { color: var(--color-green); }
.agent-view__status--error   { color: var(--color-red); }
.agent-view__status--aborted { color: var(--color-yellow); }
.agent-view__status--idle    { color: var(--color-dim); }
@keyframes agentViewPulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.4; }
}
.agent-view__name {
  flex: 1;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.agent-view__meta {
  display: flex;
  gap: 10px;
  font-size: 10px;
  color: var(--color-dim);
  font-variant-numeric: tabular-nums;
}

.agent-view__await {
  padding: 6px 12px;
  font-size: 11px;
  color: var(--color-yellow);
  font-style: italic;
  background: color-mix(in srgb, var(--color-yellow) 6%, transparent);
  border-bottom: 1px solid var(--color-line);
}
.agent-view__error {
  padding: 6px 12px;
  color: var(--color-red);
  background: var(--color-red-soft-08);
  border-bottom: 1px solid var(--color-line);
}
.agent-view__thinking {
  padding: 6px 12px;
  font-size: 10px;
  border-bottom: 1px solid var(--color-line);
}
.agent-view__thinking summary {
  cursor: pointer;
  color: var(--color-magenta);
  user-select: none;
}
.agent-view__think-block {
  margin: 4px 0 0 0;
  padding: 6px 8px;
  background: var(--color-overlay-faint);
  border-left: 2px solid var(--color-magenta);
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 10px;
  color: var(--color-fg);
  opacity: 0.85;
  max-height: 160px;
  overflow-y: auto;
}
.agent-view__output {
  flex: 1;
  margin: 0;
  padding: 8px 12px;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-y: auto;
  background: transparent;
  font-size: 11px;
  line-height: 1.45;
}
.agent-view__waiting {
  padding: 16px 12px;
  color: var(--color-dim);
  font-style: italic;
  text-align: center;
}
</style>
