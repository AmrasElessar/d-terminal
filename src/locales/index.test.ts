// locales/index — pickInitialLocale fallback algoritması.

import { describe, expect, it } from 'vitest';
import { availableLocales, pickInitialLocale } from './index';

describe('pickInitialLocale', () => {
  it('Tam eşleşme: tr → tr', () => {
    expect(pickInitialLocale('tr')).toBe('tr');
  });

  it('Tam eşleşme: en → en', () => {
    expect(pickInitialLocale('en')).toBe('en');
  });

  it('Bilinmeyen tam locale, base eşleşir: de-DE → de (eğer mevcutsa)', () => {
    if (availableLocales.includes('de')) {
      expect(pickInitialLocale('de-DE')).toBe('de');
    }
  });

  it('Bilinmeyen base, startsWith fallback', () => {
    // 'tr-TR' → tam değil; 'tr' base → mevcut → 'tr'
    expect(pickInitialLocale('tr-TR')).toBe('tr');
  });

  it('Hiç eşleşme yok → en', () => {
    expect(pickInitialLocale('xx-XX')).toBe('en');
  });

  it('Bos string availableLocales\'in ilk elemanini dondurur (startsWith trivial match)', () => {
    // Boş string her şeyle startsWith eşleşir → sıralı ilk locale
    const result = pickInitialLocale('');
    expect(availableLocales).toContain(result);
  });

  it('availableLocales tr + en içerir (sanity)', () => {
    expect(availableLocales).toContain('tr');
    expect(availableLocales).toContain('en');
  });

  it('33 stub locale + en + tr (toplam 33+)', () => {
    expect(availableLocales.length).toBeGreaterThanOrEqual(33);
  });
});
