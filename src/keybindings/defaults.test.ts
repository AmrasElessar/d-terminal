// keybindings/defaults — sanity check: id benzersiz, combo formatı sağlam.

import { describe, expect, it } from 'vitest';
import { DEFAULT_SHORTCUTS } from './defaults';

describe('DEFAULT_SHORTCUTS', () => {
  it('En az 20 varsayılan kısayol tanımlı', () => {
    expect(DEFAULT_SHORTCUTS.length).toBeGreaterThanOrEqual(20);
  });

  it('Her shortcut id + combo + labelKey içerir', () => {
    for (const s of DEFAULT_SHORTCUTS) {
      expect(s.id).toBeTruthy();
      expect(s.combo).toBeTruthy();
      expect(s.labelKey).toBeTruthy();
    }
  });

  it('id\'ler benzersiz', () => {
    const ids = DEFAULT_SHORTCUTS.map((s) => s.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('combo formatı: modifier+key+key ya da F1/F11 gibi tek tuş', () => {
    const PATTERN = /^(?:(?:Ctrl|Alt|Shift|Meta)\+)*[-A-Za-z0-9\\=,/[\]]+$|^F\d{1,2}$/;
    for (const s of DEFAULT_SHORTCUTS) {
      expect(s.combo, `combo invalid: ${s.id} → ${s.combo}`).toMatch(PATTERN);
    }
  });

  it('Tab kısayolları (tab.new, tab.close, tab.next, tab.prev) mevcut', () => {
    const ids = DEFAULT_SHORTCUTS.map((s) => s.id);
    expect(ids).toContain('tab.new');
    expect(ids).toContain('tab.close');
    expect(ids).toContain('tab.next');
    expect(ids).toContain('tab.prev');
  });

  it('Pane kısayolları mevcut', () => {
    const ids = DEFAULT_SHORTCUTS.map((s) => s.id);
    expect(ids).toContain('pane.new');
    expect(ids).toContain('pane.close');
    expect(ids).toContain('pane.splitHorizontal');
    expect(ids).toContain('pane.splitVertical');
  });
});
