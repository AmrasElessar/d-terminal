// Theme store — JSON yükleme + schema validation + active selection.
// api.themesList mock'lanır; bozuk şema reddedilir, geçerli olanlar listelenir.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const themesListMock = vi.fn();
vi.mock('@/api/tauri', () => ({
  api: {
    themesList: () => themesListMock(),
  },
}));

vi.mock('@/themes/apply', () => ({
  applyTheme: vi.fn(),
}));

import { useThemeStore } from './theme';

const VALID_THEME = {
  name: 'D-Dark',
  author: 'D Brand',
  version: '1.0.0',
  description: 'Test',
  background: 'dark',
  colors: {
    background: '#000000',
    foreground: '#ffffff',
    accent: '#00b4d8',
    accent2: '#7c3aed',
    cursor: '#00b4d8',
    selection: '#1e3a5f',
    black: '#000',
    red: '#f00',
    green: '#0f0',
    yellow: '#ff0',
    blue: '#00f',
    magenta: '#f0f',
    cyan: '#0ff',
    white: '#fff',
  },
  font: { family: 'JetBrains Mono', size: 11 },
  ui: { borderRadius: 4 },
};

describe('useThemeStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    themesListMock.mockReset();
  });

  it('Başlangıçta themes boş, activeName D-Dark', () => {
    const s = useThemeStore();
    expect(s.themes).toEqual([]);
    expect(s.activeName).toBe('D-Dark');
    expect(s.loaded).toBe(false);
  });

  it('load() geçerli tema JSON\'larını ekler', async () => {
    themesListMock.mockResolvedValueOnce([
      { name: 'D-Dark', path: '/x.json', content: JSON.stringify(VALID_THEME) },
      { name: 'D-Light', path: '/y.json', content: JSON.stringify({ ...VALID_THEME, name: 'D-Light' }) },
    ]);
    const s = useThemeStore();
    await s.load();
    expect(s.themes).toHaveLength(2);
    expect(s.loaded).toBe(true);
  });

  it('load() bozuk JSON atlanır, hata fırlatmaz', async () => {
    themesListMock.mockResolvedValueOnce([
      { name: 'D-Dark', path: '/x.json', content: JSON.stringify(VALID_THEME) },
      { name: 'broken', path: '/b.json', content: 'NOT JSON' },
    ]);
    const s = useThemeStore();
    await s.load();
    expect(s.themes).toHaveLength(1);
    expect(s.themes[0]?.name).toBe('D-Dark');
  });

  it('load() schema eksik tema reddedilir', async () => {
    const invalid = { name: 'X', author: 'me', version: '1', colors: { background: '#000' } };
    themesListMock.mockResolvedValueOnce([
      { name: 'invalid', path: '/i.json', content: JSON.stringify(invalid) },
      { name: 'valid', path: '/v.json', content: JSON.stringify({ ...VALID_THEME, name: 'OK' }) },
    ]);
    const s = useThemeStore();
    await s.load();
    expect(s.themes.map((t) => t.name)).toEqual(['OK']);
  });

  it('schema validation: required color key eksikse reddedilir', async () => {
    const missingColor = JSON.parse(JSON.stringify(VALID_THEME));
    delete missingColor.colors.cursor;
    themesListMock.mockResolvedValueOnce([
      { name: 'broken', path: '/x.json', content: JSON.stringify(missingColor) },
    ]);
    const s = useThemeStore();
    await s.load();
    expect(s.themes).toEqual([]);
  });

  it('active getter activeName ile eşleşen temayı döner', async () => {
    themesListMock.mockResolvedValueOnce([
      { name: 'D-Dark', path: '/x.json', content: JSON.stringify(VALID_THEME) },
      { name: 'D-Light', path: '/y.json', content: JSON.stringify({ ...VALID_THEME, name: 'D-Light' }) },
    ]);
    const s = useThemeStore();
    await s.load();
    expect(s.active?.name).toBe('D-Dark');
    s.setActive('D-Light');
    expect(s.active?.name).toBe('D-Light');
  });

  it('active getter eşleşme yoksa ilk temayı döner', async () => {
    themesListMock.mockResolvedValueOnce([
      { name: 'D-Other', path: '/x.json', content: JSON.stringify({ ...VALID_THEME, name: 'D-Other' }) },
    ]);
    const s = useThemeStore();
    await s.load();
    // activeName=D-Dark ama tema yok → ilk tema fallback
    expect(s.active?.name).toBe('D-Other');
  });

  it('setActive applyTheme çağırır (mock spy)', async () => {
    const { applyTheme } = await import('@/themes/apply');
    themesListMock.mockResolvedValueOnce([
      { name: 'D-Dark', path: '/x.json', content: JSON.stringify(VALID_THEME) },
    ]);
    const s = useThemeStore();
    await s.load();
    (applyTheme as unknown as ReturnType<typeof vi.fn>).mockClear();
    s.setActive('D-Dark');
    expect(applyTheme).toHaveBeenCalledTimes(1);
  });
});
