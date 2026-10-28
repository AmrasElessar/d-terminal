import { describe, expect, it } from 'vitest';
import { stripAnsi } from './ansi';

describe('stripAnsi', () => {
  it('SGR / CSI dizilerini siler', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m \x1b[?25lx')).toBe('red x');
  });
  it('BEL ve ST ile biten OSC dizilerini siler', () => {
    expect(stripAnsi('a\x1b]0;title\x07b\x1b]8;;http://x\x1b\\c')).toBe('abc');
  });
  it('düz metni değiştirmez', () => {
    expect(stripAnsi('C:\\Users\\x [1] ok')).toBe('C:\\Users\\x [1] ok');
  });
});
