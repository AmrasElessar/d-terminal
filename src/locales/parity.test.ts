// i18n parity testi — TR ve EN locale dosyaları aynı key tree'ye sahip
// olmalı. Yeni anahtarlar eklenirken iki dilde de tanımlı olduğunu garanti
// eder; aksi halde çeviri eksiği fallback chain'e düşer (TR fallback'e),
// kullanıcıya yanlış dil görünür.
//
// 31 stub locale'i kapsamaz — onlar topluluk PR'larıyla doldurulur.

import { describe, expect, it } from 'vitest';
import en from './en.json';
import tr from './tr.json';

type Json = Record<string, unknown>;

/** Recursive olarak tüm leaf key path'lerini "a.b.c" formatında topla. */
function collectKeys(obj: Json, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...collectKeys(v as Json, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

describe('i18n parity — en.json vs tr.json', () => {
  const enKeys = new Set(collectKeys(en as Json));
  const trKeys = new Set(collectKeys(tr as Json));

  it('EN has every key TR has (no orphan TR keys)', () => {
    const missing = [...trKeys].filter((k) => !enKeys.has(k) && !k.startsWith('_meta'));
    expect(missing, `EN'de eksik anahtarlar (TR'de var):\n${missing.join('\n')}`).toEqual([]);
  });

  it('TR has every key EN has (no orphan EN keys)', () => {
    const missing = [...enKeys].filter((k) => !trKeys.has(k) && !k.startsWith('_meta'));
    expect(missing, `TR'de eksik anahtarlar (EN'de var):\n${missing.join('\n')}`).toEqual([]);
  });

  it('both locales have at least 200 keys (sanity check)', () => {
    expect(enKeys.size).toBeGreaterThan(200);
    expect(trKeys.size).toBeGreaterThan(200);
  });
});
