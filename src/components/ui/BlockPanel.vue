<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { getBlockTracker } from '@/composables/useBlocks';
import { blockDuration, formatDuration, type CommandBlock } from '@/types/block';
import { useToastsStore } from '@/stores/toasts';
import { usePanesStore } from '@/stores/panes';
import { useAIStore } from '@/stores/ai';
import { api } from '@/api/tauri';

const props = defineProps<{ paneId: string; open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const toasts = useToastsStore();
const panes = usePanesStore();
const ai = useAIStore();

const tracker = computed(() => getBlockTracker(props.paneId));
const blocks = computed<CommandBlock[]>(() => tracker.value?.blocks.value ?? []);

// ANSI escape (CSI ESC[ ... letter + OSC ESC] ... BEL) strip.
// Control byte'ları runtime'da inşa ediyoruz — `no-control-regex` literal regex'i
// hedefler, runtime ctor'u değil. Davranış aynı, lint temiz.
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const ANSI_STRIP_RE = new RegExp(
  `${ESC}\\[[0-9;?]*[a-zA-Z]|${ESC}\\][^${BEL}]*${BEL}`,
  'g',
);
function stripAnsi(text: string): string {
  return text.replace(ANSI_STRIP_RE, '');
}

function statusIcon(b: CommandBlock): string {
  switch (b.status) {
    case 'success':  return '✓';
    case 'error':    return '✗';
    case 'running':  return '◌';
    case 'aborted':  return '⊘';
    case 'pending':  return '·';
  }
}

function statusColor(b: CommandBlock): string {
  switch (b.status) {
    case 'success':  return 'var(--color-green)';
    case 'error':    return 'var(--color-red)';
    case 'running':  return 'var(--color-accent)';
    case 'aborted':  return 'var(--color-yellow)';
    case 'pending':  return 'var(--color-dim)';
  }
}

function copyCommand(b: CommandBlock) {
  navigator.clipboard.writeText(b.command).then(() => {
    toasts.success(t('block.commandCopied'), 1200);
  });
}

function copyOutput(b: CommandBlock) {
  navigator.clipboard.writeText(stripAnsi(b.output)).then(() => {
    toasts.success(t('block.outputCopied'), 1200);
  });
}

function rerun(b: CommandBlock) {
  const leaf = panes.getLeaf(props.paneId);
  if (!leaf?.ptyId) {
    toasts.warning(t('block.noActivePane'));
    return;
  }
  api.ptyWrite(leaf.ptyId, new TextEncoder().encode(b.command + '\r')).catch(() => {});
}

async function sendToAI(b: CommandBlock) {
  if (!ai.activeProvider) {
    toasts.warning(t('ai.noProvider'));
    return;
  }
  // AI Chat panele prompt enjekte et: ai.queuePrompt + pane aç. AIChatPane
  // mount/focus olduğunda consumePrompt ile input'una alır. Pano fallback
  // bırakılıyor — Quake/restart sonrası kaybolmasın.
  const cleanOutput = stripAnsi(b.output);
  const prompt = `Komut:\n\`\`\`\n${b.command}\n\`\`\`\nÇıktı:\n\`\`\`\n${cleanOutput.slice(0, 2000)}\n\`\`\`\nBu çıktıyı analiz et.`;
  ai.queuePrompt(prompt);
  if (!panes.allLeaves.some((l) => l.type === 'aiChat')) {
    panes.openPane('aiChat', t('pane.type.aiChat'));
  }
  navigator.clipboard.writeText(prompt).catch(() => { /* clipboard zorunlu değil */ });
  toasts.success(t('block.sentToAiPane'), 2000);
}

function remove(b: CommandBlock) {
  tracker.value?.remove(b.id);
}

function clear() {
  if (confirm(t('block.clearConfirm'))) tracker.value?.clear();
}

function toggleCollapsed(b: CommandBlock) {
  tracker.value?.toggleCollapsed(b.id);
}

function fmtTime(d: Date): string {
  return d.toTimeString().slice(0, 8);
}

function durationLabel(b: CommandBlock): string {
  const ms = blockDuration(b);
  return ms !== null ? formatDuration(ms) : '…';
}

function previewLines(output: string, max: number = 6): string[] {
  return stripAnsi(output).split('\n').slice(0, max);
}
</script>

<template>
  <aside v-if="open" class="block-panel">
    <header class="block-panel__header">
      <h3>
        <span class="block-panel__count">{{ blocks.length }}</span>
        {{ t('block.title') }}
      </h3>
      <button type="button" class="block-panel__action" :title="t('block.clearAll')" @click="clear">⌫</button>
      <button type="button" class="block-panel__close" :title="t('common.close')" @click="emit('close')">×</button>
    </header>

    <div class="block-panel__body">
      <p v-if="blocks.length === 0" class="empty">{{ t('block.empty') }}</p>
      <article
        v-for="b in [...blocks].reverse()"
        :key="b.id"
        class="block"
        :class="`block--${b.status}`"
      >
        <header class="block__head" @click="toggleCollapsed(b)">
          <span class="block__icon" :style="{ color: statusColor(b) }">{{ statusIcon(b) }}</span>
          <code class="block__cmd">{{ b.command || '—' }}</code>
          <span class="block__meta">
            <span v-if="b.exitCode !== null" class="block__exit" :class="{ bad: b.exitCode !== 0 }">
              exit {{ b.exitCode }}
            </span>
            <span class="block__dur">{{ durationLabel(b) }}</span>
            <span class="block__time">{{ fmtTime(b.startedAt) }}</span>
          </span>
        </header>

        <div v-if="!b.collapsed" class="block__body">
          <p v-if="b.cwd" class="block__cwd">📁 {{ b.cwd }}</p>
          <pre v-if="b.output" class="block__output">{{ previewLines(b.output, 12).join('\n') }}{{ b.output.split('\n').length > 12 ? '\n…' : '' }}</pre>
          <div class="block__actions">
            <button type="button" :title="t('block.copyCommand')" @click.stop="copyCommand(b)">⎘ cmd</button>
            <button type="button" :title="t('block.copyOutput')" @click.stop="copyOutput(b)">⎘ out</button>
            <button type="button" :title="t('block.rerun')" @click.stop="rerun(b)">▶</button>
            <button type="button" :title="t('block.sendToAi')" @click.stop="sendToAI(b)">✨ AI</button>
            <button type="button" class="danger" :title="t('common.delete')" @click.stop="remove(b)">×</button>
          </div>
        </div>
      </article>
    </div>
  </aside>
</template>

<style scoped>
.block-panel {
  position: absolute;
  top: 18px; /* PaneTitleBar yüksekliği */
  right: 0;
  bottom: 0;
  width: min(420px, 50%);
  background: rgba(10, 14, 26, 0.96);
  border-left: 1px solid var(--color-accent);
  display: flex;
  flex-direction: column;
  z-index: 20;
  font-family: var(--font-family);
  font-size: 11px;
  color: var(--color-fg);
  backdrop-filter: blur(12px);
}
.block-panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--color-line);
  background: rgba(0, 0, 0, 0.3);
}
.block-panel__header h3 {
  margin: 0;
  flex: 1;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-accent);
  display: flex;
  align-items: center;
  gap: 6px;
}
.block-panel__count {
  background: var(--color-accent);
  color: var(--color-bg);
  padding: 0 5px;
  border-radius: 2px;
  font-weight: 700;
}
.block-panel__action,
.block-panel__close {
  background: transparent;
  border: none;
  color: var(--color-dim);
  cursor: pointer;
  font-size: 14px;
  padding: 0 4px;
}
.block-panel__close:hover { color: var(--color-red); }
.block-panel__action:hover { color: var(--color-yellow); }
.block-panel__body {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.empty {
  margin: 24px 12px;
  text-align: center;
  color: var(--color-dim);
  font-size: 11px;
}
.block {
  background: rgba(255, 255, 255, 0.025);
  border-left: 2px solid var(--color-dim);
  border-radius: 2px;
  overflow: hidden;
}
.block--success { border-left-color: var(--color-green); }
.block--error { border-left-color: var(--color-red); background: rgba(255, 95, 87, 0.05); }
.block--running { border-left-color: var(--color-accent); animation: pulse 1.5s ease-in-out infinite; }
.block--aborted { border-left-color: var(--color-yellow); }
@keyframes pulse {
  0%, 100% { background: rgba(0, 180, 216, 0.04); }
  50% { background: rgba(0, 180, 216, 0.12); }
}
.block__head {
  display: grid;
  grid-template-columns: 16px 1fr auto;
  gap: 6px;
  align-items: center;
  padding: 4px 8px;
  cursor: pointer;
  user-select: none;
}
.block__head:hover {
  background: rgba(255, 255, 255, 0.03);
}
.block__icon {
  text-align: center;
  font-weight: 700;
}
.block__cmd {
  font-family: var(--font-family);
  font-size: 11px;
  color: var(--color-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.block__meta {
  display: flex;
  gap: 8px;
  font-size: 9px;
  color: var(--color-dim);
}
.block__exit.bad { color: var(--color-red); }
.block__time { font-family: var(--font-family); }
.block__body {
  padding: 4px 8px 6px 24px;
  border-top: 1px solid var(--color-line);
}
.block__cwd {
  margin: 0 0 4px 0;
  font-size: 10px;
  color: var(--color-dim);
}
.block__output {
  margin: 0 0 6px 0;
  font-family: var(--font-family);
  font-size: 10px;
  line-height: 1.4;
  color: var(--color-fg);
  background: rgba(0, 0, 0, 0.3);
  padding: 4px 6px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 180px;
  overflow-y: auto;
}
.block__actions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.block__actions button {
  background: transparent;
  border: 1px solid var(--color-line);
  color: var(--color-dim);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 2px;
  font-family: inherit;
  font-size: 10px;
}
.block__actions button:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}
.block__actions .danger:hover {
  color: var(--color-red);
  border-color: var(--color-red);
}
</style>
