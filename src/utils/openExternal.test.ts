import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn(() => Promise.resolve()) }));

import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { isOpenablePath, openExternalUrl, safeHttpUrl } from './openExternal';

describe('safeHttpUrl', () => {
  it('http(s) kabul', () => {
    expect(safeHttpUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeHttpUrl('http://localhost:3000')).toBe('http://localhost:3000/');
  });
  it('tehlikeli şemalar ve gömülü kimlik reddedilir', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('file:///C:/Windows/system32/calc.exe')).toBeNull();
    expect(safeHttpUrl('ms-settings:privacy')).toBeNull();
    expect(safeHttpUrl('\\\\host\\share')).toBeNull();
    expect(safeHttpUrl('https://user:pw@evil.com')).toBeNull();
    expect(safeHttpUrl('not a url')).toBeNull();
  });
});

describe('openExternalUrl', () => {
  it('yalnızca güvenli URL için shell open çağırır', async () => {
    expect(await openExternalUrl('javascript:x')).toBe(false);
    expect(shellOpen).not.toHaveBeenCalled();
    expect(await openExternalUrl('https://a.dev')).toBe(true);
    expect(shellOpen).toHaveBeenCalledWith('https://a.dev/');
  });
});

describe('isOpenablePath', () => {
  it('dizin ve metin dosyaları açılabilir', () => {
    expect(isOpenablePath('C:\\Users\\x\\proj')).toBe(true);
    expect(isOpenablePath('C:\\Users\\x\\notes.md')).toBe(true);
    expect(isOpenablePath('C:/Users/x/log.txt')).toBe(true);
  });
  it('çalıştırılabilir / handler uzantıları ve UNC reddedilir', () => {
    for (const ext of ['exe', 'js', 'hta', 'vbe', 'reg', 'url', 'cpl', 'msc', 'lnk', 'ps1', 'search-ms']) {
      expect(isOpenablePath(`C:\\x\\a.${ext}`)).toBe(false);
    }
    expect(isOpenablePath('\\\\host\\share\\a.txt')).toBe(false);
    expect(isOpenablePath('./relative/a.txt')).toBe(false);
  });
});
