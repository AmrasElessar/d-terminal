// Session serialize/deserialize. PaneTree → JSON ↔ JSON → PaneTree.
//
// Çalışan process state restore edilmez (architecture-v1.1.md §5.3).
// Sadece pane tipi/konum/boyut + AI conversation ve title.

import type { PaneNode, PaneTree, SplitNode } from '@/types/pane';

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
  type: PaneNode extends { type: infer T } ? T : never;
  title: string;
}
type SerializedNode = SerializedSplit | SerializedLeaf;

interface SerializedTree {
  version: 1;
  root: SerializedNode | null;
}

export function serializeTree(tree: PaneTree): string {
  const root = tree.root ? serializeNode(tree.root) : null;
  const data: SerializedTree = { version: 1, root };
  return JSON.stringify(data);
}

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
  return {
    kind: 'leaf',
    id: node.id,
    type: node.type as never,
    title: node.title,
  };
}

export function deserializeTree(json: string): PaneNode | null {
  const data = JSON.parse(json) as SerializedTree;
  if (!data.root) return null;
  return deserializeNode(data.root);
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
  return {
    kind: 'leaf',
    id: node.id,
    type: node.type as PaneNode extends { type: infer T } ? T : never,
    title: node.title,
    status: 'idle',
  } as PaneNode;
}
