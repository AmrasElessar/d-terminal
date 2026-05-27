// pane.ts — findLeaf + listLeaves recursive helper testleri.

import { describe, expect, it } from 'vitest';
import { findLeaf, listLeaves, type LeafNode, type SplitNode } from './pane';

function leaf(id: string): LeafNode {
  return { kind: 'leaf', id, type: 'powershell', title: id, status: 'idle' };
}

function split(id: string, dir: 'horizontal' | 'vertical', a: LeafNode | SplitNode, b: LeafNode | SplitNode): SplitNode {
  return { kind: 'split', id, direction: dir, ratio: 0.5, first: a, second: b };
}

describe('findLeaf', () => {
  it('null root → null', () => {
    expect(findLeaf(null, 'x')).toBeNull();
  });

  it('tek leaf, eşleşen id → leaf', () => {
    const a = leaf('a');
    expect(findLeaf(a, 'a')).toBe(a);
  });

  it('tek leaf, eşleşmeyen id → null', () => {
    const a = leaf('a');
    expect(findLeaf(a, 'b')).toBeNull();
  });

  it('split altında ilk dalda bulur', () => {
    const a = leaf('a');
    const b = leaf('b');
    const root = split('s1', 'horizontal', a, b);
    expect(findLeaf(root, 'a')).toBe(a);
  });

  it('split altında ikinci dalda bulur', () => {
    const a = leaf('a');
    const b = leaf('b');
    const root = split('s1', 'horizontal', a, b);
    expect(findLeaf(root, 'b')).toBe(b);
  });

  it('iç içe split — derin leaf bulunur', () => {
    const c = leaf('c');
    const inner = split('s2', 'vertical', leaf('a'), leaf('b'));
    const root = split('s1', 'horizontal', inner, c);
    expect(findLeaf(root, 'b')?.id).toBe('b');
    expect(findLeaf(root, 'c')).toBe(c);
  });

  it('split id eşleşmez — yalnız leaf id\'leri match olur', () => {
    const root = split('s1', 'horizontal', leaf('a'), leaf('b'));
    expect(findLeaf(root, 's1')).toBeNull();
  });
});

describe('listLeaves', () => {
  it('null → boş', () => {
    expect(listLeaves(null)).toEqual([]);
  });

  it('tek leaf → tek elemanlı dizi', () => {
    const a = leaf('a');
    expect(listLeaves(a)).toEqual([a]);
  });

  it('basit split → DFS sırası: first sonra second', () => {
    const a = leaf('a');
    const b = leaf('b');
    const ids = listLeaves(split('s1', 'horizontal', a, b)).map((l) => l.id);
    expect(ids).toEqual(['a', 'b']);
  });

  it('iç içe split → derinlik öncelikli flatten', () => {
    const inner = split('s2', 'vertical', leaf('a'), leaf('b'));
    const root = split('s1', 'horizontal', inner, leaf('c'));
    const ids = listLeaves(root).map((l) => l.id);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('asimmetrik tree → tüm leaf\'ler dahil', () => {
    // s1 -> (s2 -> (s3 -> (a, b), c), d)
    const innerMost = split('s3', 'vertical', leaf('a'), leaf('b'));
    const middle = split('s2', 'horizontal', innerMost, leaf('c'));
    const root = split('s1', 'horizontal', middle, leaf('d'));
    const ids = listLeaves(root).map((l) => l.id);
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });
});
