// logger — level filtering + bridge invoke + factory API.
//
// NOT: createLogger module yüklendiğinde `console.info.bind(console)` gibi
// referansları sabitler — vi.spyOn(console, 'info') sonradan çağrılmış spy'ı
// göremez. Bu nedenle direkt console output assertion yerine bridge invoke
// üzerinden davranış test ediliyor (gerçek production telemetri yolu).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { createLogger, setBridgeEnabled, setMinLevel } from './logger';

describe('createLogger', () => {
  beforeEach(() => {
    invokeMock.mockReset().mockResolvedValue(undefined);
    setMinLevel('trace');
    setBridgeEnabled(true);
  });

  afterEach(() => {
    setMinLevel('info');
    setBridgeEnabled(true);
  });

  it('5 method dönerse (trace/debug/info/warn/error)', () => {
    const log = createLogger('test');
    expect(typeof log.trace).toBe('function');
    expect(typeof log.debug).toBe('function');
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
  });

  it('Bridge enabled: log_event invoke çağrılır', () => {
    const log = createLogger('panes');
    log.info('opened pane');
    expect(invokeMock).toHaveBeenCalledWith('log_event', expect.objectContaining({
      event: expect.objectContaining({
        level: 'info',
        source: 'panes',
        message: 'opened pane',
      }),
    }));
  });

  it('fields invoke payload\'una eklenir', () => {
    const log = createLogger('x');
    log.warn('msg', { id: 'a', n: 42 });
    const call = invokeMock.mock.calls[0]!;
    expect((call[1] as { event: { fields: unknown } }).event.fields).toEqual({ id: 'a', n: 42 });
  });

  it('fields verilmezse payload.fields null', () => {
    const log = createLogger('x');
    log.info('msg');
    const call = invokeMock.mock.calls[0]!;
    expect((call[1] as { event: { fields: unknown } }).event.fields).toBeNull();
  });

  it('minLevel=warn → info çağrısı bridge\'e gitmez', () => {
    setMinLevel('warn');
    const log = createLogger('x');
    log.info('skip me');
    expect(invokeMock).not.toHaveBeenCalled();
    log.warn('show me');
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('minLevel=error → warn da yutulur', () => {
    setMinLevel('error');
    const log = createLogger('x');
    log.warn('skip');
    log.info('skip');
    log.error('show');
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect((invokeMock.mock.calls[0]![1] as { event: { level: string } }).event.level).toBe('error');
  });

  it('setBridgeEnabled(false) → invoke hiç çağrılmaz', () => {
    setBridgeEnabled(false);
    const log = createLogger('x');
    log.info('no bridge');
    log.error('no bridge');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('Bridge reject olsa logger çağrı sessizce devam eder', () => {
    invokeMock.mockRejectedValueOnce(new Error('backend offline'));
    const log = createLogger('x');
    expect(() => log.info('msg')).not.toThrow();
  });

  it('5 farklı seviye doğru level field\'ı ile gider', () => {
    const log = createLogger('x');
    log.trace('t');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    const levels = invokeMock.mock.calls.map(
      (c) => (c[1] as { event: { level: string } }).event.level,
    );
    expect(levels).toEqual(['trace', 'debug', 'info', 'warn', 'error']);
  });
});
