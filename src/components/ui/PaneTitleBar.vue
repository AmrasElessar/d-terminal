<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { LeafNode } from '@/types/pane';
import { usePanesStore } from '@/stores/panes';
import { useAgentWatchStore } from '@/stores/agentWatch';

const panes = usePanesStore();
const agentWatch = useAgentWatchStore();

const props = defineProps<{
  leaf: LeafNode;
  focused: boolean;
  blockCount?: number;
  blockPanelOpen?: boolean;
}>();
const emit = defineEmits<{ close: []; toggleBlocks: [] }>();

const { t } = useI18n();

const typeLabel = computed(() => t(`pane.type.${props.leaf.type}`));
const statusLabel = computed(() => {
  if (props.leaf.status === 'exited') {
    return t('pane.status.exited', { code: props.leaf.exitCode ?? 0 });
  }
  return t(`pane.status.${props.leaf.status}`);
});
const title = computed(() => props.leaf.title || t('pane.untitled'));

/** Title bar drag handle — pane'i başka pane'in kenarına bırakarak
 *  yeniden konumlandırma. */
function onDragStart(e: DragEvent) {
  if (!e.dataTransfer) return;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('application/x-pane-id', props.leaf.id);
  e.dataTransfer.setData('text/plain', props.leaf.title || props.leaf.id);
  panes.draggingPaneId = props.leaf.id;
}
function onDragEnd() {
  panes.draggingPaneId = null;
}

// --- Inline title rename ---
const editingTitle = ref(false);
const titleDraft = ref('');
const titleInputRef = ref<HTMLInputElement | null>(null);

async function startEditTitle() {
  editingTitle.value = true;
  titleDraft.value = props.leaf.title;
  await nextTick();
  titleInputRef.value?.focus();
  titleInputRef.value?.select();
}
function commitTitle() {
  if (!editingTitle.value) return;
  const next = titleDraft.value.trim();
  if (next && next !== props.leaf.title) {
    panes.setLeafState(props.leaf.id, { title: next });
  }
  editingTitle.value = false;
}
function cancelTitle() {
  editingTitle.value = false;
}

// --- Inline tag (grup) ---
const editingTag = ref(false);
const tagDraft = ref('');
const tagInputRef = ref<HTMLInputElement | null>(null);

async function startEditTag() {
  editingTag.value = true;
  tagDraft.value = props.leaf.tag ?? '';
  await nextTick();
  tagInputRef.value?.focus();
  tagInputRef.value?.select();
}
function commitTag() {
  if (!editingTag.value) return;
  const next = tagDraft.value.trim();
  panes.setLeafState(props.leaf.id, { tag: next.length > 0 ? next : undefined });
  editingTag.value = false;
}
function cancelTag() {
  editingTag.value = false;
}

/** Tag string'inden palet renk üretir — aynı tag her zaman aynı rengi alır,
 *  böylece kullanıcı pane'lerini birden fazla yere bakmadan görsel olarak
 *  gruplayabilir. */
const TAG_PALETTE = [
  '#ef4444', // red
  '#22c55e', // green
  '#3b82f6', // blue
  '#eab308', // yellow
  '#a855f7', // purple
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
];
function colorForTag(tag: string | undefined): string {
  if (!tag) return '';
  let h = 0;
  for (let i = 0; i < tag.length; i++) {
    h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  }
  return TAG_PALETTE[h % TAG_PALETTE.length] ?? '';
}
const tagColor = computed(() => colorForTag(props.leaf.tag));

/** Broadcast aktif + bu pane hedeflerden biri ise true (yayın altındayız uyarısı). */
const broadcasting = computed(
  () =>
    panes.broadcastInput
    && !!props.leaf.ptyId
    && props.leaf.status === 'running',
);

/** Agent Watch sidebar'ı bu pane için. Reactive view paneView'dan gelir. */
const agentView = agentWatch.paneView(props.leaf.id);
const agentRunning = computed(() => agentView.value.agents.some((a) => a.status === 'running'));
function toggleAgentWatch() {
  agentWatch.toggleVisible(props.leaf.id);
}
</script>

<template>
  <div
    class="title-bar"
    :class="{ focused }"
    :draggable="!editingTitle && !editingTag"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
  >
    <div class="title-bar__indicator" :data-status="leaf.status" />
    <div class="title-bar__type">{{ typeLabel }}</div>
    <input
      v-if="editingTitle"
      ref="titleInputRef"
      v-model="titleDraft"
      class="title-bar__title-input"
      type="text"
      spellcheck="false"
      maxlength="80"
      @keydown.enter.prevent="commitTitle"
      @keydown.escape.prevent="cancelTitle"
      @blur="commitTitle"
      @mousedown.stop
    />
    <div
      v-else
      class="title-bar__title"
      :title="t('pane.actions.rename')"
      @dblclick.stop="startEditTitle"
    >
      {{ title }}
    </div>
    <div class="title-bar__status">{{ statusLabel }}</div>

    <span
      v-if="broadcasting"
      class="title-bar__bcast"
      :title="t('statusBar.broadcastHint')"
      :aria-label="t('statusBar.broadcastOn')"
    >⌘</span>

    <input
      v-if="editingTag"
      ref="tagInputRef"
      v-model="tagDraft"
      class="title-bar__tag-input"
      type="text"
      spellcheck="false"
      maxlength="20"
      :placeholder="t('pane.tag.placeholder')"
      @keydown.enter.prevent="commitTag"
      @keydown.escape.prevent="cancelTag"
      @blur="commitTag"
      @mousedown.stop
    />
    <button
      v-else-if="leaf.tag"
      type="button"
      class="title-bar__tag"
      :style="{ '--tag-color': tagColor, borderColor: tagColor, color: tagColor }"
      :title="t('pane.tag.edit')"
      @click.stop="startEditTag"
    >
      <span class="title-bar__tag-dot" :style="{ background: tagColor }" />
      {{ leaf.tag }}
    </button>
    <button
      v-else
      type="button"
      class="title-bar__tag-add"
      :title="t('pane.tag.add')"
      :aria-label="t('pane.tag.add')"
      @click.stop="startEditTag"
    >
#
</button>

    <button
      v-if="agentView.hasAny || agentView.visible"
      type="button"
      class="title-bar__agent"
      :class="{
        active: agentView.visible,
        running: agentRunning,
      }"
      :title="t('agentWatch.toggle', { count: agentView.agents.length })"
      @click.stop="toggleAgentWatch"
    >
👁 {{ agentView.agents.length }}
</button>
    <button
      v-if="blockCount && blockCount > 0"
      type="button"
      class="title-bar__blocks"
      :class="{ active: blockPanelOpen }"
      :title="t('block.title')"
      @click.stop="emit('toggleBlocks')"
    >
▣ {{ blockCount }}
</button>
    <button
      type="button"
      class="title-bar__close"
      :title="t('pane.close')"
      :aria-label="t('pane.close')"
      @click.stop="emit('close')"
    >
×
</button>
  </div>
</template>

<style scoped>
.title-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 1px 6px;
  background: var(--color-overlay-light);
  border-bottom: 1px solid var(--color-line);
  font-size: 10px;
  user-select: none;
  flex-shrink: 0;
  height: 18px;
  font-family: var(--font-family);
}
.title-bar.focused {
  background: var(--color-accent-soft-12);
  border-bottom-color: var(--color-accent);
}
.title-bar__indicator {
  width: 6px;
  height: 6px;
  border-radius: 0;
  background: var(--color-dim);
  opacity: 0.6;
  flex-shrink: 0;
}
.title-bar__indicator[data-status="running"] {
  background: var(--color-green);
  opacity: 0.9;
}
.title-bar__indicator[data-status="error"] {
  background: var(--color-red);
  opacity: 0.9;
}
.title-bar__indicator[data-status="exited"] {
  background: var(--color-yellow);
  opacity: 0.7;
}
.title-bar__indicator[data-status="spawning"] {
  background: var(--color-accent);
  opacity: 0.6;
  animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
.title-bar__type {
  font-weight: 600;
  color: var(--color-accent);
  text-transform: lowercase;
  letter-spacing: 0;
  font-size: 9px;
}
.title-bar__type::after { content: ':'; }
.title-bar__title {
  flex: 1;
  font-family: var(--font-family);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-fg);
  cursor: text;
}
.title-bar__title:hover {
  text-decoration: underline dotted;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}
.title-bar__title-input {
  flex: 1;
  background: var(--color-bg);
  color: var(--color-fg);
  border: 1px solid var(--color-accent);
  border-radius: 2px;
  font-family: inherit;
  font-size: 10px;
  padding: 0 4px;
  margin: 1px 0;
  outline: none;
  min-width: 0;
  height: 14px;
}
.title-bar__status {
  color: var(--color-dim);
  font-size: 9px;
}
/* Broadcast hedef pane uyarısı — yayın aktif ve bu pane'e tuş gidiyor. */
.title-bar__bcast {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--color-yellow);
  text-shadow: 0 0 4px var(--color-yellow);
  padding: 0 3px;
  animation: bcastPulse 1.4s ease-in-out infinite;
  cursor: help;
}
@keyframes bcastPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
.title-bar__tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 1px solid var(--color-line);
  cursor: pointer;
  font-size: 9px;
  line-height: 1;
  padding: 1px 5px;
  border-radius: 8px;
  font-family: inherit;
  color: var(--color-fg);
  max-width: 120px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.title-bar__tag-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.title-bar__tag-add {
  background: transparent;
  border: 1px dashed var(--color-line);
  color: var(--color-dim);
  cursor: pointer;
  font-size: 10px;
  line-height: 1;
  padding: 0 5px;
  border-radius: 8px;
  font-family: inherit;
  opacity: 0.5;
  height: 14px;
}
.title-bar__tag-add:hover {
  opacity: 1;
  color: var(--color-accent);
  border-color: var(--color-accent);
}
.title-bar__tag-input {
  background: var(--color-bg);
  color: var(--color-fg);
  border: 1px solid var(--color-accent);
  border-radius: 2px;
  font-family: inherit;
  font-size: 9px;
  padding: 0 4px;
  outline: none;
  width: 90px;
  height: 14px;
}
.title-bar__blocks,
.title-bar__agent {
  background: transparent;
  border: 1px solid var(--color-line);
  color: var(--color-dim);
  cursor: pointer;
  font-size: 9px;
  line-height: 1;
  padding: 1px 5px;
  border-radius: 2px;
  font-family: inherit;
}
.title-bar__blocks:hover,
.title-bar__blocks.active,
.title-bar__agent:hover,
.title-bar__agent.active {
  color: var(--color-accent);
  border-color: var(--color-accent);
}
/* Agent çalışıyorsa nabız + vurgu — kullanıcı görmezden gelmesin. */
.title-bar__agent.running {
  color: var(--color-green);
  border-color: var(--color-green);
  animation: titleAgentPulse 1.5s ease-in-out infinite;
}
@keyframes titleAgentPulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.55; }
}
.title-bar__close {
  background: transparent;
  border: none;
  color: var(--color-dim);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 4px;
  border-radius: 0;
}
.title-bar__close:hover {
  background: var(--color-red);
  opacity: 1;
}
</style>
