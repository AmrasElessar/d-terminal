// Session/Workspace serialize/deserialize.
//
// PaneTree → JSON ↔ JSON → PaneTree. Çalışan process state restore edilmez
// (architecture-v1.1.md §5.3). Sadece pane tipi/konum/boyut + profileId + tag
// + title kaydedilir; PTY restore'da profile'a göre yeni spawn olur.
//
// Schema sürüm 1: tek tab (root). v0.1.0 backward compat.
// Schema sürüm 2: tabs[] dizisi — workspace olarak adlandırılan, tüm tab'ların
// yapısını saklar; tags + profileId dahildir. v0.1.1+ varsayılanı.

import type {
  LeafNode,
  PaneNode,
  PaneTree,
  PaneType,
  SplitNode,
  Tab,
} from '@/types/pane';

interface SerializedSplit {
  kind: 'split';
  id: string;
  direction: 'horizontal' | 'vertical';
  ratio: number;
  first: SerializedNode;
  second: SerializedNode;
}
interface SerializedLeaf {
  kind: 'leaf';
  id: string;
  type: PaneType;
  title: string;
  profileId?: string;
  tag?: string;
}
type SerializedNode = SerializedSplit | SerializedLeaf;

interface SerializedTab {
  id: string;
  name: string;
  root: SerializedNode | null;
  focusedId: string | null;
}

/** v1: tek tab tree. Eski session kayıtları bu format. */
interface SerializedV1 {
  version: 1;
  root: SerializedNode | null;
}
/** v2: tüm workspace — tab listesi + her tab'da tree. */
interface SerializedV2 {
  version: 2;
  tabs: SerializedTab[];
  activeTabId: string | null;
}
type Serialized = SerializedV1 | SerializedV2;

// --- Single tree (v1, eski API uyumluluğu için korunuyor) ---

export function serializeTree(tree: PaneTree): string {
  const root = tree.root ? serializeNode(tree.root) : null;
  const data: SerializedV1 = { version: 1, root };
  return JSON.stringify(data);
}

export function deserializeTree(json: string): PaneNode | null {
  const data = JSON.parse(json) as Serialized;
  if (data.version === 2) {
    // v2 yüklenirken tek tab tree isteniyorsa: aktif tab'ı al
    const active = data.tabs.find((t) => t.id === data.activeTabId) ?? data.tabs[0];
    if (!active || !active.root) return null;
    return deserializeNode(active.root);
  }
  if (!data.root) return null;
  return deserializeNode(data.root);
}

// --- Workspace (v2 — tüm tab'lar) ---

export function serializeWorkspace(tabs: Tab[], activeTabId: string | null): string {
  const data: SerializedV2 = {
    version: 2,
    tabs: tabs.map((t) => ({
      id: t.id,
      name: t.name,
      focusedId: t.tree.focusedId,
      root: t.tree.root ? serializeNode(t.tree.root) : null,
    })),
    activeTabId,
  };
  return JSON.stringify(data);
}

export interface DeserializedWorkspace {
  tabs: Tab[];
  activeTabId: string | null;
}

export function deserializeWorkspace(json: string): DeserializedWorkspace | null {
  const data = JSON.parse(json) as Serialized;
  if (data.version === 2) {
    return {
      tabs: data.tabs.map((s) => ({
        id: s.id,
        name: s.name,
        tree: {
          root: s.root ? deserializeNode(s.root) : null,
          focusedId: s.focusedId,
        },
      })),
      activeTabId: data.activeTabId,
    };
  }
  // v1 fallback: tek tree → tek tab içine sar
  if (!data.root) return null;
  const root = deserializeNode(data.root);
  return {
    tabs: [
      {
        id: crypto.randomUUID(),
        name: 'Tab 1',
        tree: { root, focusedId: root.kind === 'leaf' ? root.id : null },
      },
    ],
    activeTabId: null,
  };
}

// --- Internal helpers ---

function serializeNode(node: PaneNode): SerializedNode {
  if (node.kind === 'split') {
    const split: SerializedSplit = {
      kind: 'split',
      id: node.id,
      direction: node.direction,
      ratio: node.ratio,
      first: serializeNode(node.first),
      second: serializeNode(node.second),
    };
    return split;
  }
  const leaf: SerializedLeaf = {
    kind: 'leaf',
    id: node.id,
    type: node.type,
    title: node.title,
  };
  if (node.profileId) leaf.profileId = node.profileId;
  if (node.tag) leaf.tag = node.tag;
  return leaf;
}

function deserializeNode(node: SerializedNode): PaneNode {
  if (node.kind === 'split') {
    return {
      kind: 'split',
      id: node.id,
      direction: node.direction,
      ratio: node.ratio,
      first: deserializeNode(node.first),
      second: deserializeNode(node.second),
    } satisfies SplitNode;
  }
  const leaf: LeafNode = {
    kind: 'leaf',
    id: node.id,
    type: node.type,
    title: node.title,
    status: 'idle',
  };
  if (node.profileId) leaf.profileId = node.profileId;
  if (node.tag) leaf.tag = node.tag;
  return leaf;
}
