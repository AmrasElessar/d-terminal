// useContextMenu — sağ tık menüsü global state.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useContextMenu, type MenuEntry } from './useContextMenu';

function makeMouseEvent(x: number, y: number): MouseEvent {
  return new MouseEvent('contextmenu', {
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
  });
}

describe('useContextMenu', () => {
  beforeEach(() => {
    useContextMenu().hide();
  });

  it('Başlangıçta open=false ve items boş', () => {
    const m = useContextMenu();
    expect(m.state.open).toBe(false);
    expect(m.state.items).toEqual([]);
  });

  it('show konum + items atar ve open=true yapar', () => {
    const m = useContextMenu();
    const items: MenuEntry[] = [
      { id: 'copy', label: 'Copy', onClick: vi.fn() },
      { kind: 'separator' },
      { id: 'paste', label: 'Paste', onClick: vi.fn() },
    ];
    m.show(makeMouseEvent(120, 240), items);
    expect(m.state.open).toBe(true);
    expect(m.state.x).toBe(120);
    expect(m.state.y).toBe(240);
    expect(m.state.items).toHaveLength(3);
  });

  it('hide open=false yapar', () => {
    const m = useContextMenu();
    m.show(makeMouseEvent(10, 10), [{ id: 'x', label: 'X', onClick: vi.fn() }]);
    m.hide();
    expect(m.state.open).toBe(false);
  });

  it('Aynı useContextMenu state referansı paylaşır', () => {
    const m1 = useContextMenu();
    const m2 = useContextMenu();
    m1.show(makeMouseEvent(0, 0), [{ id: 'a', label: 'a', onClick: vi.fn() }]);
    expect(m2.state.open).toBe(true);
  });

  it('Ardışık show konum günceller, items değiştirir', () => {
    const m = useContextMenu();
    m.show(makeMouseEvent(50, 50), [{ id: 'a', label: 'A', onClick: vi.fn() }]);
    m.show(makeMouseEvent(100, 100), [
      { id: 'b', label: 'B', onClick: vi.fn() },
      { id: 'c', label: 'C', onClick: vi.fn() },
    ]);
    expect(m.state.x).toBe(100);
    expect(m.state.y).toBe(100);
    expect(m.state.items).toHaveLength(2);
  });
});
