// useBlocks — OSC 133 command block tracker.
// State machine: PromptStart(A) → CommandStart(B) → CommandRun(C) → CommandEnd(D).

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createBlockTracker,
  registerBlockTracker,
  unregisterBlockTracker,
  getBlockTracker,
} from './useBlocks';

describe('createBlockTracker — OSC 133 state machine', () => {
  let t = createBlockTracker();
  beforeEach(() => {
    t = createBlockTracker();
  });

  it('Başlangıçta boş blocks dizisi', () => {
    expect(t.blocks.value).toEqual([]);
    expect(t.active()).toBeNull();
  });

  it('promptStart → commandStart → commandRun → commandEnd başarılı block oluşturur', () => {
    t.onPromptStart();
    t.onCommandStart();
    t.onCommandRun('ls -la');
    t.onCommandEnd(0);
    expect(t.blocks.value).toHaveLength(1);
    const b = t.blocks.value[0]!;
    expect(b.command).toBe('ls -la');
    expect(b.status).toBe('success');
    expect(b.exitCode).toBe(0);
    expect(b.startedAt).toBeInstanceOf(Date);
    expect(b.endedAt).toBeInstanceOf(Date);
  });

  it('exitCode ≠ 0 → error status', () => {
    t.onPromptStart();
    t.onCommandStart();
    t.onCommandRun('bad');
    t.onCommandEnd(1);
    expect(t.blocks.value[0]?.status).toBe('error');
    expect(t.blocks.value[0]?.exitCode).toBe(1);
  });

  it('Boş block prompt sonrası yeni prompt alırsa silinir (Ctrl+C scenario)', () => {
    t.onPromptStart();
    t.onCommandStart(); // boş — kullanıcı hiçbir şey yazmadı
    // Yeni prompt
    t.onPromptStart();
    expect(t.blocks.value).toEqual([]);
  });

  it('running block yeni prompt alınca aborted işaretlenir', () => {
    t.onPromptStart();
    t.onCommandStart();
    t.onCommandRun('sleep 10');
    t.onPromptStart(); // Ctrl+C — komut iptal
    expect(t.blocks.value).toHaveLength(1);
    expect(t.blocks.value[0]?.status).toBe('aborted');
    expect(t.blocks.value[0]?.endedAt).toBeInstanceOf(Date);
  });

  it('onCwd active block cwd alanına yazar; sonraki block için pending kullanılır', () => {
    t.onCwd('C:\\Users\\foo');
    t.onPromptStart();
    t.onCommandStart();
    t.onCommandRun('echo a');
    t.onCommandEnd(0);
    expect(t.blocks.value[0]?.cwd).toBe('C:\\Users\\foo');
  });

  it('onCwd çalışan block sırasında değişirse aktif block cwd anlık güncellenir', () => {
    t.onPromptStart();
    t.onCommandStart();
    t.onCwd('/home/x');
    expect(t.active()?.cwd).toBe('/home/x');
  });

  it('onOutput active block output stringine append', () => {
    t.onPromptStart();
    t.onCommandStart();
    t.onCommandRun('cat f');
    t.onOutput('line1\n');
    t.onOutput('line2\n');
    expect(t.blocks.value[0]?.output).toBe('line1\nline2\n');
    expect(t.blocks.value[0]?.outputLineCount).toBe(2);
  });

  it('onOutput 256KB üstünde rotate eder (son baytlar kalır)', () => {
    t.onPromptStart();
    t.onCommandStart();
    t.onCommandRun('big');
    const huge = 'x'.repeat(300 * 1024);
    t.onOutput(huge);
    const out = t.blocks.value[0]?.output ?? '';
    expect(out.length).toBeLessThanOrEqual(256 * 1024);
  });

  it('onUserInput karakterleri biriktirir, Enter ile komut başlatır', () => {
    t.onPromptStart();
    t.onCommandStart();
    t.onUserInput('e');
    t.onUserInput('c');
    t.onUserInput('h');
    t.onUserInput('o');
    t.onUserInput(' ');
    t.onUserInput('hi');
    t.onUserInput('\r');
    expect(t.blocks.value[0]?.command).toBe('echo hi');
    expect(t.blocks.value[0]?.status).toBe('running');
  });

  it('onUserInput backspace son karakteri siler', () => {
    t.onPromptStart();
    t.onCommandStart();
    t.onUserInput('abc');
    t.onUserInput('\x7f'); // backspace
    t.onUserInput('!');
    t.onUserInput('\r');
    expect(t.blocks.value[0]?.command).toBe('ab!');
  });

  it('remove(id) ilgili block çıkarır', () => {
    t.onPromptStart();
    t.onCommandStart();
    t.onCommandRun('a');
    t.onCommandEnd(0);
    const id = t.blocks.value[0]!.id;
    t.remove(id);
    expect(t.blocks.value).toEqual([]);
  });

  it('clear() tüm state sıfırlar', () => {
    t.onPromptStart();
    t.onCommandStart();
    t.onCommandRun('a');
    t.onCommandEnd(0);
    t.clear();
    expect(t.blocks.value).toEqual([]);
    expect(t.active()).toBeNull();
  });

  it('toggleCollapsed flag çevirir', () => {
    t.onPromptStart();
    t.onCommandStart();
    t.onCommandRun('a');
    const id = t.blocks.value[0]!.id;
    expect(t.blocks.value[0]?.collapsed).toBe(false);
    t.toggleCollapsed(id);
    expect(t.blocks.value[0]?.collapsed).toBe(true);
    t.toggleCollapsed(id);
    expect(t.blocks.value[0]?.collapsed).toBe(false);
  });

  it('onCommandEnd active block yoksa no-op', () => {
    t.onCommandEnd(0); // hiç prompt yok
    expect(t.blocks.value).toEqual([]);
  });

  it('onOutput active block yoksa no-op', () => {
    t.onOutput('hello');
    expect(t.blocks.value).toEqual([]);
  });

  it('Control karakterleri (örn. arrow) input accumulator dışında kalır', () => {
    t.onPromptStart();
    t.onCommandStart();
    t.onUserInput('echo');
    t.onUserInput('\x1b'); // ESC — atlanır
    t.onUserInput('\x01'); // Ctrl+A — atlanır
    t.onUserInput('\r');
    expect(t.blocks.value[0]?.command).toBe('echo');
  });
});

describe('Block tracker global registry', () => {
  it('register + get + unregister round-trip', () => {
    const t = createBlockTracker();
    expect(getBlockTracker('p1')).toBeNull();
    registerBlockTracker('p1', t);
    expect(getBlockTracker('p1')).toBe(t);
    unregisterBlockTracker('p1');
    expect(getBlockTracker('p1')).toBeNull();
  });

  it('Farklı paneId farklı tracker döner', () => {
    const a = createBlockTracker();
    const b = createBlockTracker();
    registerBlockTracker('pA', a);
    registerBlockTracker('pB', b);
    expect(getBlockTracker('pA')).toBe(a);
    expect(getBlockTracker('pB')).toBe(b);
    unregisterBlockTracker('pA');
    unregisterBlockTracker('pB');
  });
});
