// Locale paritesi: tr.json ve en.json aynı key ağacına sahip olmalı.
// Eksik veya fazla key olursa hangi yolda olduğunu gösterir.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..', '..');
const tr = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/locales/tr.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/locales/en.json'), 'utf8'));

function flatKeys(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flatKeys(v, full));
    } else {
      out.push(full);
    }
  }
  return out;
}

test('locale parity — tr ⇔ en have identical key trees', () => {
  const trKeys = new Set(flatKeys(tr));
  const enKeys = new Set(flatKeys(en));

  const missingInEn = [...trKeys].filter((k) => !enKeys.has(k));
  const missingInTr = [...enKeys].filter((k) => !trKeys.has(k));

  assert.deepEqual(missingInEn, [], `Keys in tr.json missing from en.json:\n  ${missingInEn.join('\n  ')}`);
  assert.deepEqual(missingInTr, [], `Keys in en.json missing from tr.json:\n  ${missingInTr.join('\n  ')}`);
});

test('locale values are non-empty strings', () => {
  const issues = [];
  function walk(obj, prefix, lang) {
    for (const [k, v] of Object.entries(obj)) {
      const full = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'string') {
        if (!v.trim()) issues.push(`${lang}: empty value at ${full}`);
      } else if (v && typeof v === 'object') {
        walk(v, full, lang);
      } else {
        issues.push(`${lang}: non-string leaf at ${full} (${typeof v})`);
      }
    }
  }
  walk(tr, '', 'tr');
  walk(en, '', 'en');
  assert.deepEqual(issues, [], issues.join('\n'));
});
