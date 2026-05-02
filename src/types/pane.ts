// Pane sistemi tip tanımları.
//
// PaneNode = SplitNode | LeafNode (recursive)
// SplitNode: yatay/dikey ayırıcı, iki çocuk
// LeafNode: gerçek bir pane (terminal, AI chat, welcome…)

export type PaneType = 'powershell' | 'cmd' | 'wsl' | 'aiChat' | 'logStream' | 'welcome';

export type PaneStatus = 'idle' | 'spawning' | 'running' | 'suspended' | 'exited' | 'error';

export type SplitDirection = 'horizontal' | 'vertical';

export interface LeafNode {
  kind: 'leaf';
  id: string;                  // UI içi unique pane id
  type: PaneType;
  title: string;               // kullanıcının verdiği isim, yoksa varsayılan
  /** Backend pane id (terminal pane'leri için sidecar id'si). */
  ptyId?: string;
  status: PaneStatus;
  exitCode?: number;
  errorMessage?: string;
  /** Pane'in kendi state JSON'u — terminal scrollback, AI conversation vb. */
  state?: unknown;
}

export interface SplitNode {
  kind: 'split';
  id: string;
  direction: SplitDirection;
  /** İlk çocuğun aldığı oran (0..1). */
  ratio: number;
  first: PaneNode;
  second: PaneNode;
}

export type PaneNode = LeafNode | SplitNode;

export interface PaneTree {
  root: PaneNode | null;
  focusedId: string | null;
}

/** UI seviyesinde leaf bul. */
export function findLeaf(node: PaneNode | null, id: string): LeafNode | null {
  if (!node) return null;
  if (node.kind === 'leaf') return node.id === id ? node : null;
  return findLeaf(node.first, id) ?? findLeaf(node.second, id);
}

/** Tüm leaf'leri sıralı listele (DFS). */
export function listLeaves(node: PaneNode | null): LeafNode[] {
  if (!node) return [];
  if (node.kind === 'leaf') return [node];
  return [...listLeaves(node.first), ...listLeaves(node.second)];
}
