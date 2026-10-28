// decodePtyData — pty://stdout payload'ı (base64 string veya eski number[]).

import { describe, expect, it } from 'vitest';
import { decodePtyData } from './events';

describe('decodePtyData', () => {
  it('base64 string → byte dizisi', () => {
    // "héllo\n" UTF-8
    const bytes = new TextEncoder().encode('héllo\n');
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    expect(Array.from(decodePtyData(btoa(bin)))).toEqual(Array.from(bytes));
  });

  it('eski backend number[] formatını kabul eder', () => {
    expect(Array.from(decodePtyData([104, 105]))).toEqual([104, 105]);
  });

  it('Uint8Array olduğu gibi döner', () => {
    const u = new Uint8Array([1, 2, 3]);
    expect(decodePtyData(u)).toBe(u);
  });

  it('boş / null / bozuk base64 → boş dizi, fırlatmaz', () => {
    expect(decodePtyData('').length).toBe(0);
    expect(decodePtyData(null).length).toBe(0);
    expect(decodePtyData(undefined).length).toBe(0);
    expect(decodePtyData('***not base64***').length).toBe(0);
  });

  it('ESC / yüksek baytlar korunur', () => {
    const raw = new Uint8Array([0x1b, 0x5b, 0x33, 0x31, 0x6d, 0xff, 0x00]);
    let bin = '';
    for (const b of raw) bin += String.fromCharCode(b);
    expect(Array.from(decodePtyData(btoa(bin)))).toEqual(Array.from(raw));
  });
});
