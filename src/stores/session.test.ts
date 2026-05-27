// session.ts — workspace serialize/deserialize round-trip testleri.
// Schema v1 (tek tab) ↔ v2 (tabs[]) geriye dönük uyumluluk dahil.

import { describe, expect, it } from 'vitest';
import {
  serializeTree,
  deserializeTree,
  serializeWorkspace,
  deserializeWorkspace,
} from './session';
import type { LeafNode, SplitNode, Tab } from '@/types/pane';

function leaf(id: string, extras: Partial<LeafNode> = {}): LeafNode {
  return {
    kind: 'leaf',
    id,
    type: 'powershell',
    title: `T-${id}`,
    status: 'idle',
    ...extras,
  };
}

describe('serializeTree / deserializeTree (v1)', () => {
  it('null root → JSON parse edilebilir, deserialize null', () => {
    const json = serializeTree({ root: null, focusedId: null });
    expect(JSON.parse(json).version).toBe(1);
    expect(deserializeTree(json)).toBeNull();
  });

  it('tek leaf round-trip — id/type/title korunur', () => {
    const a = leaf('a');
    const json = serializeTree({ root: a, focusedId: 'a' });
    const restored = deserializeTree(json);
    expect(restored).not.toBeNull();
    if (!restored) throw new Error('restored null');
    expect(restored.kind).toBe('leaf');
    if (restored.kind === 'leaf') {
      expect(restored.id).toBe('a');
      expect(restored.type).toBe('powershell');
      expect(restored.title).toBe('T-a');
      expect(restored.status).toBe('idle');
    }
  });

  it('split round-trip — direction/ratio korunur', () => {
    const root: SplitNode = {
      kind: 'split',
      id: 's1',
      direction: 'horizontal',
      ratio: 0.4,
      first: leaf('a'),
      second: leaf('b'),
    };
    const json = serializeTree({ root, focusedId: 'a' });
    const restored = deserializeTree(json);
    expect(restored?.kind).toBe('split');
    if (restored?.kind === 'split') {
      expect(restored.direction).toBe('horizontal');
      expect(restored.ratio).toBe(0.4);
    }
  });

  it('profileId + tag opsiyonel alanlar round-trip eder', () => {
    const root = leaf('a', { profileId: 'p-ssh', tag: 'work' });
    const json = serializeTree({ root, focusedId: 'a' });
    const restored = deserializeTree(json);
    if (restored?.kind === 'leaf') {
      expect(restored.profileId).toBe('p-ssh');
      expect(restored.tag).toBe('work');
    }
  });

  it('ptyId, status (exited) gibi runtime alanları kaydedilmez — restore idle olur', () => {
    const root = leaf('a', { ptyId: 'pty-123', status: 'running' });
    const json = serializeTree({ root, focusedId: 'a' });
    const data = JSON.parse(json);
    expect(data.root.ptyId).toBeUndefined();
    expect(data.root.status).toBeUndefined();
    const restored = deserializeTree(json);
    if (restored?.kind === 'leaf') {
      expect(restored.status).toBe('idle');
      expect(restored.ptyId).toBeUndefined();
    }
  });
});

describe('serializeWorkspace / deserializeWorkspace (v2)', () => {
  function tab(id: string, name: string, root: LeafNode | SplitNode | null, focusedId: string | null): Tab {
    return { id, name, tree: { root, focusedId } };
  }

  it('boş workspace serialize/deserialize', () => {
    const json = serializeWorkspace([], null);
    expect(JSON.parse(json).version).toBe(2);
    const restored = deserializeWorkspace(json);
    expect(restored).not.toBeNull();
    expect(restored!.tabs).toEqual([]);
    expect(restored!.activeTabId).toBeNull();
  });

  it('iki tab round-trip — name + focusedId + activeTabId', () => {
    const tabs: Tab[] = [
      tab('t1', 'Work', leaf('a'), 'a'),
      tab('t2', 'Side', leaf('b'), 'b'),
    ];
    const json = serializeWorkspace(tabs, 't2');
    const restored = deserializeWorkspace(json)!;
    expect(restored.tabs).toHaveLength(2);
    expect(restored.tabs[0]?.name).toBe('Work');
    expect(restored.tabs[1]?.name).toBe('Side');
    expect(restored.tabs[0]?.tree.focusedId).toBe('a');
    expect(restored.activeTabId).toBe('t2');
  });

  it('iç içe split tab içinde restore edilir', () => {
    const inner: SplitNode = {
      kind: 'split',
      id: 's2',
      direction: 'vertical',
      ratio: 0.3,
      first: leaf('a'),
      second: leaf('b'),
    };
    const root: SplitNode = {
      kind: 'split',
      id: 's1',
      direction: 'horizontal',
      ratio: 0.5,
      first: inner,
      second: leaf('c'),
    };
    const json = serializeWorkspace([tab('t1', 'Nest', root, 'a')], 't1');
    const restored = deserializeWorkspace(json)!;
    const tree = restored.tabs[0]?.tree.root;
    expect(tree?.kind).toBe('split');
    if (tree?.kind === 'split') {
      expect(tree.first.kind).toBe('split');
    }
  });
});

describe('v1 → v2 backward compatibility', () => {
  it('deserializeWorkspace v1 JSON\'u tek tab içine sarar', () => {
    const v1json = serializeTree({ root: leaf('a'), focusedId: 'a' });
    const restored = deserializeWorkspace(v1json)!;
    expect(restored.tabs).toHaveLength(1);
    expect(restored.tabs[0]?.name).toBe('Tab 1');
    expect(restored.tabs[0]?.tree.root?.kind).toBe('leaf');
  });

  it('deserializeTree v2 JSON\'u — aktif tab\'ı çıkarır', () => {
    const tabs: Tab[] = [
      { id: 't1', name: 'A', tree: { root: leaf('x'), focusedId: 'x' } },
      { id: 't2', name: 'B', tree: { root: leaf('y'), focusedId: 'y' } },
    ];
    const json = serializeWorkspace(tabs, 't2');
    const restored = deserializeTree(json);
    if (restored?.kind === 'leaf') {
      expect(restored.id).toBe('y');
    } else {
      throw new Error('expected leaf');
    }
  });

  it('deserializeWorkspace v1 boş root → null', () => {
    const json = serializeTree({ root: null, focusedId: null });
    expect(deserializeWorkspace(json)).toBeNull();
  });
});
