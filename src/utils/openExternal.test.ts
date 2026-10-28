import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn(() => Promise.resolve()) }));

import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { installExternalLinkHandler, openExternalUrl, safeHttpUrl } from './openExternal';

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

describe('mailto + link handler', () => {
  it('mailto kabul', () => {
    expect(safeHttpUrl('mailto:a@b.dev')).toBe('mailto:a@b.dev');
  });
  it('a[href] tıklaması varsayılanı engeller ve dışarıda açar', async () => {
    const off = installExternalLinkHandler();
    const a = document.createElement('a');
    a.href = 'https://example.org/x';
    a.target = '_blank';
    document.body.appendChild(a);
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    await Promise.resolve();
    expect(shellOpen).toHaveBeenCalledWith('https://example.org/x');
    off();
    a.remove();
  });
});
