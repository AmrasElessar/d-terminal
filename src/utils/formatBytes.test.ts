import { describe, expect, it } from 'vitest';
import { formatBytes } from './formatBytes';

describe('formatBytes', () => {
  it('returns "0 B" for zero, negative, NaN, Infinity', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B');
  });

  it('uses B for sub-KB values without decimals', () => {
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('rolls over to KB exactly at 1024', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('drops decimals for values ≥ 10 in any unit', () => {
    expect(formatBytes(10 * 1024)).toBe('10 KB');
    expect(formatBytes(99 * 1024)).toBe('99 KB');
  });

  it('uses MB for million-byte ranges', () => {
    expect(formatBytes(12_345_678)).toBe('12 MB');
    expect(formatBytes(1_572_864)).toBe('1.5 MB');
  });

  it('uses GB for billion-byte ranges', () => {
    expect(formatBytes(2 * 1024 ** 3)).toBe('2.0 GB');
    expect(formatBytes(15 * 1024 ** 3)).toBe('15 GB');
  });

  it('stops scaling at TB (largest unit)', () => {
    expect(formatBytes(1024 ** 4)).toBe('1.0 TB');
    // Çok büyük değerlerde TB'da devam — birim atlama yok.
    expect(formatBytes(5000 * 1024 ** 4)).toMatch(/TB$/);
  });
});
