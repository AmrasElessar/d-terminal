// confirmAsk — Tauri 2 native dialog wrapper'ı için test.
// Plugin başarılı path + plugin reject fallback path + options forwarding.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const askMock = vi.fn();

vi.mock('@tauri-apps/plugin-dialog', () => ({
  ask: (...args: unknown[]) => askMock(...args),
}));

describe('confirmAsk', () => {
  beforeEach(() => {
    askMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('plugin başarılı → dönüş değeri direkt iletilir (true)', async () => {
    askMock.mockResolvedValueOnce(true);
    const { confirmAsk } = await import('./dialog');
    const r = await confirmAsk('Devam edilsin mi?');
    expect(r).toBe(true);
    expect(askMock).toHaveBeenCalledTimes(1);
  });

  it('plugin başarılı → false döner', async () => {
    askMock.mockResolvedValueOnce(false);
    const { confirmAsk } = await import('./dialog');
    const r = await confirmAsk('Sil?');
    expect(r).toBe(false);
  });

  it('options (title + kind) plugin\'e iletilir', async () => {
    askMock.mockResolvedValueOnce(true);
    const { confirmAsk } = await import('./dialog');
    await confirmAsk('Kapatılsın mı?', { title: 'Pane', kind: 'warning' });
    expect(askMock).toHaveBeenCalledWith('Kapatılsın mı?', {
      title: 'Pane',
      kind: 'warning',
    });
  });

  it('plugin reject ederse window.confirm fallback (true)', async () => {
    askMock.mockRejectedValueOnce(new Error('capability denied'));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    const { confirmAsk } = await import('./dialog');
    const r = await confirmAsk('Yine soralım?');
    expect(r).toBe(true);
    expect(confirmSpy).toHaveBeenCalledWith('Yine soralım?');
  });

  it('plugin reject + window.confirm cancel (false)', async () => {
    askMock.mockRejectedValueOnce(new Error('plugin yok'));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    const { confirmAsk } = await import('./dialog');
    const r = await confirmAsk('Onay gerek');
    expect(r).toBe(false);
    expect(confirmSpy).toHaveBeenCalled();
  });

  it('options olmadan çağrılırsa undefined olarak iletilir', async () => {
    askMock.mockResolvedValueOnce(true);
    const { confirmAsk } = await import('./dialog');
    await confirmAsk('Sade soru?');
    expect(askMock).toHaveBeenCalledWith('Sade soru?', undefined);
  });

  it('plugin throw eden senkron hata → fallback yine devreye girer', async () => {
    askMock.mockImplementationOnce(() => {
      throw new Error('sync throw');
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    const { confirmAsk } = await import('./dialog');
    const r = await confirmAsk('Sync hata?');
    expect(r).toBe(true);
    expect(confirmSpy).toHaveBeenCalled();
  });
});
