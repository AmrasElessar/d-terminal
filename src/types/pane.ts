// Pane sistemi tip tanımları.
//
// PaneNode = SplitNode | LeafNode (recursive)
// SplitNode: yatay/dikey ayırıcı, iki çocuk
// LeafNode: gerçek bir pane (terminal, AI chat, welcome…)

export type PaneType = 'powershell' | 'cmd' | 'wsl' | 'aiChat' | 'logStream' | 'welcome' | 'agentView';

export type PaneStatus = 'idle' | 'spawning' | 'running' | 'suspended' | 'exited' | 'error';

export type SplitDirection = 'horizontal' | 'vertical';

export interface LeafNode {
  kind: 'leaf';
  id: string;                  // UI içi unique pane id
  type: PaneType;
  title: string;               // kullanıcının verdiği isim, yoksa varsayılan
  /** Hangi shell profilinden spawn edildi (terminal pane'leri için). Built-in
   *  profile id'si veya kullanıcı profil id'si. Boş ise paneType'a göre default. */
  profileId?: string;
  /** Backend pane id (terminal pane'leri için sidecar id'si). */
  ptyId?: string;
  status: PaneStatus;
  exitCode?: number;
  errorMessage?: string;
  /** Pane'in kendi state JSON'u — terminal scrollback, AI conversation vb. */
  state?: unknown;
  /** Çalışma odağı için kullanıcı etiketi. Aynı tag'i taşıyan pane'ler aynı
   *  renkte gösterilir (renk tag string hash'inden derive edilir). Boş = grup yok. */
  tag?: string;
  /** Pane-bazlı font size offset'i (Ctrl+= / Ctrl+- / Ctrl+0 ile). Effective
   *  font size = settings.fontSize + (fontSizeOffset ?? 0), clamp [8, 32]. */
  fontSizeOffset?: number;
  /** Bu pane bir Agent View ise hangi parent terminal'i + agent'ı izliyor.
   *  agentView dışındaki pane tiplerinde set edilmez. */
  agentSourcePaneId?: string;
  agentId?: string;
}

/** Pane font-size sınırları — global ayar üstüne offset eklenirken bu aralığa clamp. */
export const PANE_FONT_MIN = 8;
export const PANE_FONT_MAX = 32;

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

/** Tab = bağımsız pane tree konteyneri.
 *  Her tab kendi split layout'una sahip; tab içindeki split'ler eskisi gibi çalışır.
 *  Backend için her tab içindeki pane'ler ayrı PTY'lere bağlanır. */
export interface Tab {
  id: string;
  name: string;
  tree: PaneTree;
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
