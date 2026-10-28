import { describe, expect, it } from 'vitest';
import { lineCountOf, preparePaste, prepareInsert } from './paste';

describe('preparePaste', () => {
  it('bracketed modda sarar, \\n → \\r', () => {
    expect(preparePaste('a\nb', true)).toBe('\x1b[200~a\rb\x1b[201~');
  });
  it('gömülü paste-bitiş dizisi temizlenir (bracketed kaçışı yok)', () => {
    const evil = 'echo hi\x1b[201~\rrm -rf x\r';
    expect(preparePaste(evil, true)).toBe('\x1b[200~echo hi\rrm -rf x\r\x1b[201~');
  });
  it('bracketed değilse ham', () => {
    expect(preparePaste('a\r\nb', false)).toBe('a\rb');
  });
});

describe('prepareInsert', () => {
  it('bracketed yoksa satır sonları boşluk olur — hiçbir satır çalışmaz', () => {
    expect(prepareInsert('git add .\ngit commit\n', false)).toBe('git add . git commit');
  });
  it('bracketed varsa sarılır', () => {
    expect(prepareInsert('a\nb\n', true)).toBe('\x1b[200~a\rb\x1b[201~');
  });
});

describe('lineCountOf', () => {
  it('satır sayar', () => {
    expect(lineCountOf('a')).toBe(1);
    expect(lineCountOf('a\nb\r\nc')).toBe(3);
  });
});
