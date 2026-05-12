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

/**
 * Nested obje yapı paritesi — leaf path eşleşmesi (yukarıdaki collectKeys)
 * iki dilde aynı leaf'leri garanti eder ama nested obje vs string drift'i
 * yakalamaz: EN'de `foo.bar` nested object, TR'de `foo.bar` string olursa
 * leaf set'leri farklı görünür ama yine de yapı bozulur. Bu test her path
 * için node tipini (object | leaf) karşılaştırır.
 */
function structuralShape(obj: Json): unknown {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return '<leaf>';
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    out[k] = structuralShape((obj as Json)[k] as Json);
  }
  return out;
}

describe('i18n parity — yapı derinliği (tree structure)', () => {
  it('EN ve TR nested obje yapı ağaçları birebir eşleşir (_meta hariç)', () => {
    const enCopy = { ...(en as Json) };
    const trCopy = { ...(tr as Json) };
    delete enCopy._meta;
    delete trCopy._meta;
    const enShape = JSON.stringify(structuralShape(enCopy));
    const trShape = JSON.stringify(structuralShape(trCopy));
    expect(enShape, 'Yapısal mismatch: bir tarafta nested object, diğerinde leaf').toBe(trShape);
  });
});
