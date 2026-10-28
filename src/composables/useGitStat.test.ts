// parseOsc7CwdPayload — OSC 7 file:// payload → Windows path normalize.
// Tek başına saf fonksiyon, Tauri API'sine bağımlı değil.

import { describe, expect, it } from 'vitest';
import { isSafeLocalDrivePath, parseOsc7CwdPayload } from './useGitStat';

describe('parseOsc7CwdPayload', () => {
  it('Windows file:///C:/path → C:\\path (forward → back slash)', () => {
    const r = parseOsc7CwdPayload('file:///C:/Users/Engin/Desktop/');
    expect(r).toBe('C:\\Users\\Engin\\Desktop\\');
  });

  it('URL-encoded boşluk %20 → düz boşluk', () => {
    const r = parseOsc7CwdPayload('file:///C:/My%20Documents/');
    expect(r).toBe('C:\\My Documents\\');
  });

  it('Türkçe karakterler URL-decode edilir', () => {
    const r = parseOsc7CwdPayload('file:///C:/T%C3%BCrk%C3%A7e/');
    expect(r).toBe('C:\\Türkçe\\');
  });

  it('host kısmı (file://localhost/...) atlanır, path korunur', () => {
    const r = parseOsc7CwdPayload('file://localhost/C:/temp/');
    expect(r).toBe('C:\\temp\\');
  });

  it('non-Windows path (Linux tarzı) backslash dönüştürülür ama drive yok', () => {
    // Bu dt Windows app olsa da fonksiyon defensive — /home/x/... gelirse
    // başında slash kalır ve backslash'e çevrilir.
    // Unix yolu (WSL) — git_diff_shortstat Windows yolu bekler, reddedilir
    const r = parseOsc7CwdPayload('file:///home/engin/proj');
    expect(r).toBeNull();
  });

  it('invalid URL (file:// prefix yok) → null', () => {
    expect(parseOsc7CwdPayload('C:/just/path')).toBeNull();
    expect(parseOsc7CwdPayload('http://example.com/x')).toBeNull();
  });

  it('boş payload → null', () => {
    expect(parseOsc7CwdPayload('')).toBeNull();
  });

  it('bozuk URL-encoding (% sonrası geçersiz) → graceful, hata fırlatmaz', () => {
    // decodeURIComponent fırlatır; parser yutar ve raw path'i normalize eder.
    const r = parseOsc7CwdPayload('file:///C:/bad%ZZ/');
    // Hata fırlatmadığını ve bir string döndüğünü doğrula
    expect(typeof r).toBe('string');
    expect(r).toContain('C:');
  });

  it('drive letter küçük harfli (file:///c:/...) → korur', () => {
    const r = parseOsc7CwdPayload('file:///c:/Users/');
    expect(r).toBe('c:\\Users\\');
  });

  it('PowerShell COMPUTERNAME host kabul edilir', () => {
    expect(parseOsc7CwdPayload('file://DESKTOP-AB12/C:/x/')).toBe('C:\\x\\');
  });

  it('UNC / NTLM sızıntı denemeleri reddedilir', () => {
    expect(parseOsc7CwdPayload('file:////attacker/share')).toBeNull();
    expect(parseOsc7CwdPayload('file:///%5C%5Cattacker%5Cshare')).toBeNull();
    expect(parseOsc7CwdPayload('file:///%5C%5C%3F%5CUNC%5Ch%5Cs')).toBeNull();
    expect(parseOsc7CwdPayload('file:///%5C%3F%3F%5CUNC%5Ch%5Cs')).toBeNull();
    expect(parseOsc7CwdPayload('file:///%5C%5C.%5Cpipe%5Cx')).toBeNull();
    expect(parseOsc7CwdPayload('file://evil.example.com/C:/x')).toBeNull();
  });

  it('.. segmenti, ADS ve kontrol karakteri reddedilir', () => {
    expect(parseOsc7CwdPayload('file:///C:/a/../b')).toBeNull();
    expect(parseOsc7CwdPayload('file:///C:/a:stream')).toBeNull();
    expect(parseOsc7CwdPayload('file:///C:/a%0Ab')).toBeNull();
  });
});

describe('isSafeLocalDrivePath', () => {
  it('yerel sürücü yollarını kabul eder', () => {
    expect(isSafeLocalDrivePath('C:\\Users\\x')).toBe(true);
    expect(isSafeLocalDrivePath('D:')).toBe(true);
  });
  it('UNC / device / göreli yolları reddeder', () => {
    expect(isSafeLocalDrivePath('\\\\host\\share')).toBe(false);
    expect(isSafeLocalDrivePath('\\\\?\\C:\\x')).toBe(false);
    expect(isSafeLocalDrivePath('relative\\x')).toBe(false);
  });
});
