import { describe, expect, it } from 'vitest';
import { createLineFeeder } from './shellIntegration';

describe('createLineFeeder', () => {
  it('chunk sınırlarında satırları birleştirir, ANSI ve \\r temizler', () => {
    const lines: string[] = [];
    const f = createLineFeeder({ onLine: (l) => lines.push(l) });
    f.feed('\x1b[31mhel');
    f.feed('lo\x1b[0m\r\nwor');
    f.feed('ld\n');
    expect(lines).toEqual(['hello', 'world']);
  });

  it('newline içermeyen dev çıktı sınırlı tutulur', () => {
    const lines: string[] = [];
    const f = createLineFeeder({ onLine: (l) => lines.push(l), maxLine: 10 });
    f.feed('x'.repeat(25));
    expect(lines.length).toBe(1);
    expect(lines[0]!.length).toBe(10);
  });
});
