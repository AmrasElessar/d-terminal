// fonts — fallbackChain (saf) + BUNDLED_FONTS sanity check.
// ensureFontLoaded dinamik import @fontsource yapar; vitest'te
// real fetch yapmaz ama vi.mock olmadan da çağrılabilir (loader
// resolution edilirken hatası catch'lenir).

import { describe, expect, it } from 'vitest';
import { BUNDLED_FONTS, DEFAULT_FONT_FAMILY, fallbackChain } from './fonts';

describe('fallbackChain', () => {
  it('primary fontu öne koyar', () => {
    const chain = fallbackChain('JetBrains Mono');
    expect(chain.startsWith('"JetBrains Mono"')).toBe(true);
  });

  it('Noto Sans Mono ikinci sırada (non-Latin script fallback)', () => {
    const chain = fallbackChain('Fira Code');
    const parts = chain.split(',').map((s) => s.trim());
    expect(parts[0]).toBe('"Fira Code"');
    expect(parts[1]).toBe('"Noto Sans Mono"');
  });

  it('monospace son fallback', () => {
    const chain = fallbackChain('X');
    expect(chain.endsWith('monospace')).toBe(true);
  });

  it('Tüm font isimleri çift tırnak içinde (boşluklu adlar için)', () => {
    const chain = fallbackChain('Cascadia Code');
    // monospace hariç hepsi quoted
    const quoted = chain.match(/"[^"]+"/g);
    expect(quoted).not.toBeNull();
    expect(quoted!.length).toBeGreaterThanOrEqual(5);
  });
});

describe('BUNDLED_FONTS', () => {
  it('17 font (her birinin family + label + license var)', () => {
    expect(BUNDLED_FONTS.length).toBe(17);
    for (const f of BUNDLED_FONTS) {
      expect(f.family).toBeTruthy();
      expect(f.label).toBeTruthy();
      expect(f.license).toBeTruthy();
      expect(typeof f.ligatures).toBe('boolean');
      expect(typeof f.multiScript).toBe('boolean');
    }
  });

  it('DEFAULT_FONT_FAMILY BUNDLED_FONTS içinde', () => {
    const names = BUNDLED_FONTS.map((f) => f.family);
    expect(names).toContain(DEFAULT_FONT_FAMILY);
  });

  it('Family adları benzersiz', () => {
    const names = BUNDLED_FONTS.map((f) => f.family);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('En az 5 ligature font + 1 retro (VT323)', () => {
    expect(BUNDLED_FONTS.filter((f) => f.ligatures).length).toBeGreaterThanOrEqual(5);
    expect(BUNDLED_FONTS.find((f) => f.family === 'VT323')).toBeDefined();
  });
});
