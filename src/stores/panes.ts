// Pane tree store. Recursive split/leaf yapısını yönetir + backend sidecar
// event'lerini dinleyip leaf state'ini günceller.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { v4 as uuid } from 'uuid';
import { api } from '@/api/tauri';
import { onAllPty } from '@/api/events';
import {
  type LeafNode,
  type PaneNode,
  type PaneTree,
  type PaneType,
  type SplitDirection,
  type SplitNode,
  findLeaf,
  listLeaves,
} from '@/types/pane';

function newLeaf(type: PaneType, title: string): LeafNode {
  return {
    kind: 'leaf',
    id: uuid(),
    type,
    title,
    status: 'idle',
  };
}

function replaceNode(
  root: PaneNode | null,
  targetId: string,
  replacer: (n: PaneNode) => PaneNode,
): PaneNode | null {
  if (!root) return null;
  if (root.id === targetId) return replacer(root);
  if (root.kind === 'split') {
    return {
      ...root,
      first: replaceNode(root.first, targetId, replacer)!,
      second: replaceNode(root.second, targetId, replacer)!,
    };
  }
  return root;
}

function removeLeaf(root: PaneNode | null, targetId: string): PaneNode | null {
  if (!root) return null;
  if (root.kind === 'leaf') return root.id === targetId ? null : root;
  // Split node — bir tarafı kaldırıyorsak diğer tarafı promote et
  const newFirst = removeLeaf(root.first, targetId);
  const newSecond = removeLeaf(root.second, targetId);
  if (!newFirst) return newSecond;
  if (!newSecond) return newFirst;
  return { ...root, first: newFirst, second: newSecond };
}

export const usePanesStore = defineStore('panes', () => {
  const tree = ref<PaneTree>({ root: null, focusedId: null });
  const sidecarAlive = ref(true);

  // --- queries ---

  const focused = computed<LeafNode | null>(() => {
    if (!tree.value.focusedId) return null;
    return findLeaf(tree.value.root, tree.value.focusedId);
  });

  const allLeaves = computed<LeafNode[]>(() => listLeaves(tree.value.root));

  const paneCount = computed(() => allLeaves.value.length);

  function getLeaf(id: string): LeafNode | null {
    return findLeaf(tree.value.root, id);
  }

  // --- mutations ---

  function focus(id: string) {
    if (findLeaf(tree.value.root, id)) {
      tree.value.focusedId = id;
    }
  }

  function focusNext() {
    const leaves = allLeaves.value;
    if (leaves.length === 0) return;
    const idx = leaves.findIndex((l) => l.id === tree.value.focusedId);
    const next = leaves[(idx + 1) % leaves.length];
    if (next) tree.value.focusedId = next.id;
  }

  function focusPrev() {
    const leaves = allLeaves.value;
    if (leaves.length === 0) return;
    const idx = leaves.findIndex((l) => l.id === tree.value.focusedId);
    const prev = leaves[(idx - 1 + leaves.length) % leaves.length];
    if (prev) tree.value.focusedId = prev.id;
  }

  function openPane(type: PaneType, title: string): LeafNode {
    const leaf = newLeaf(type, title);
    if (!tree.value.root) {
      tree.value.root = leaf;
    } else if (tree.value.focusedId) {
      // Aktif pane'in yerine split koy ve sağa/aşağıya yeni leaf yerleştir
      tree.value.root = replaceNode(tree.value.root, tree.value.focusedId, (focused) => ({
        kind: 'split',
        id: uuid(),
        direction: 'horizontal',
        ratio: 0.5,
        first: focused,
        second: leaf,
      }));
    } else {
      // Hiçbir focus yoksa root'u split'le
      tree.value.root = {
        kind: 'split',
        id: uuid(),
        direction: 'horizontal',
        ratio: 0.5,
        first: tree.value.root,
        second: leaf,
      } satisfies SplitNode;
    }
    tree.value.focusedId = leaf.id;
    return leaf;
  }

  function splitFocused(direction: SplitDirection, type: PaneType, title: string) {
    const focusedId = tree.value.focusedId;
    if (!focusedId) {
      openPane(type, title);
      return;
    }
    const leaf = newLeaf(type, title);
    tree.value.root = replaceNode(tree.value.root, focusedId, (focused) => ({
      kind: 'split',
      id: uuid(),
      direction,
      ratio: 0.5,
      first: focused,
      second: leaf,
    }));
    tree.value.focusedId = leaf.id;
  }

  async function closePane(id: string) {
    const leaf = getLeaf(id);
    if (leaf?.ptyId) {
      try {
        await api.ptyKill(leaf.ptyId);
      } catch {
        // Pane çoktan ölmüş olabilir; sessiz geç
      }
    }
    tree.value.root = removeLeaf(tree.value.root, id);
    if (tree.value.focusedId === id) {
      const remaining = listLeaves(tree.value.root);
      tree.value.focusedId = remaining[0]?.id ?? null;
    }
  }

  function setLeafState(id: string, patch: Partial<LeafNode>) {
    tree.value.root = replaceNode(tree.value.root, id, (n) => {
      if (n.kind !== 'leaf') return n;
      return { ...n, ...patch };
    });
  }

  function setSplitRatio(id: string, ratio: number) {
    tree.value.root = replaceNode(tree.value.root, id, (n) => {
      if (n.kind !== 'split') return n;
      return { ...n, ratio: Math.max(0.1, Math.min(0.9, ratio)) };
    });
  }

  // --- backend events ---

  let unlisteners: Array<() => void> = [];

  async function startListening() {
    if (unlisteners.length > 0) return;
    const list = await onAllPty((evt) => {
      switch (evt.kind) {
        case 'sidecar_up':
          sidecarAlive.value = true;
          break;
        case 'sidecar_down':
          sidecarAlive.value = false;
          // Tüm terminal pane'lerini error state'e taşı
          for (const leaf of listLeaves(tree.value.root)) {
            if (leaf.ptyId) {
              setLeafState(leaf.id, { status: 'error', errorMessage: evt.reason });
            }
          }
          break;
        case 'exit': {
          const target = listLeaves(tree.value.root).find((l) => l.ptyId === evt.pane_id);
          if (target) {
            setLeafState(target.id, { status: 'exited', exitCode: evt.exit_code });
          }
          break;
        }
        case 'error': {
          if (!evt.pane_id) return;
          const target = listLeaves(tree.value.root).find((l) => l.ptyId === evt.pane_id);
          if (target) {
            setLeafState(target.id, { status: 'error', errorMessage: evt.message });
          }
          break;
        }
        // 'stdout' event'i terminal komponenti tarafından doğrudan listen edilir
        // (her pane kendi xterm.js instance'ına yazar)
      }
    });
    unlisteners = list;
  }

  function stopListening() {
    for (const fn of unlisteners) fn();
    unlisteners = [];
  }

  return {
    tree,
    sidecarAlive,
    focused,
    allLeaves,
    paneCount,
    getLeaf,
    focus,
    focusNext,
    focusPrev,
    openPane,
    splitFocused,
    closePane,
    setLeafState,
    setSplitRatio,
    startListening,
    stopListening,
  };
});
