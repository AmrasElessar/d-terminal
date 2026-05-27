// useSmartLinks — file path / git SHA / IP pattern detection (xterm ILinkProvider).
// findMatches internal — bunun yerine provideLinks'i yüksek seviyede test ediyoruz.

import { describe, expect, it, vi } from 'vitest';
import type { IBufferLine, ILink, Terminal } from '@xterm/xterm';
import { createSmartLinkProvider, type SmartLinkHandlers } from './useSmartLinks';

/** Minimal Terminal mock — buffer.active.getLine() bizim string'imizi döner. */
function makeTerm(line: string): Terminal {
  const bufferLine: IBufferLine = {
    translateToString: () => line,
  } as unknown as IBufferLine;
  return {
    buffer: {
      active: {
        getLine: (_n: number) => bufferLine,
      },
    },
  } as unknown as Terminal;
}

async function provideLinks(term: Terminal, handlers: SmartLinkHandlers): Promise<ILink[]> {
  const provider = createSmartLinkProvider(term, handlers);
  return new Promise((resolve) => {
    provider.provideLinks(1, (links) => resolve(links ?? []));
  });
}

describe('createSmartLinkProvider', () => {
  it('Boş satır → undefined (link yok)', async () => {
    const term = makeTerm('');
    const links = await provideLinks(term, {});
    expect(links).toEqual([]);
  });

  it('Windows path detect — onPath çağrılır', async () => {
    const onPath = vi.fn();
    const term = makeTerm('error in C:\\Users\\foo\\src\\file.ts on line 42');
    const links = await provideLinks(term, { onPath });
    expect(links.length).toBeGreaterThanOrEqual(1);
    const pathLink = links.find((l) => l.text.startsWith('C:'));
    expect(pathLink).toBeDefined();
    pathLink!.activate({} as MouseEvent, pathLink!.text);
    expect(onPath).toHaveBeenCalledWith(expect.stringContaining('file.ts'));
  });

  it('Unix path detect', async () => {
    const onPath = vi.fn();
    const term = makeTerm('see /usr/local/bin/myapp for details');
    const links = await provideLinks(term, { onPath });
    expect(links.some((l) => l.text.includes('/usr/local/bin/myapp'))).toBe(true);
  });

  it('Relative path detect (./src/foo.ts)', async () => {
    const onPath = vi.fn();
    const term = makeTerm('compile ./src/index.ts');
    const links = await provideLinks(term, { onPath });
    expect(links.some((l) => l.text.includes('./src/index.ts'))).toBe(true);
  });

  it('Git SHA 7-40 hex detect', async () => {
    const onGitRef = vi.fn();
    const term = makeTerm('commit abc1234def5678 fix this');
    const links = await provideLinks(term, { onGitRef });
    // 7+ hex char match olmalı
    expect(links.some((l) => /^[0-9a-f]{7,40}$/.test(l.text))).toBe(true);
  });

  it('IPv4 detect', async () => {
    const onHost = vi.fn();
    const term = makeTerm('connecting to 192.168.1.1');
    const links = await provideLinks(term, { onHost });
    expect(links.some((l) => l.text === '192.168.1.1')).toBe(true);
  });

  it('IPv4:port detect', async () => {
    const onHost = vi.fn();
    const term = makeTerm('listen on 10.0.0.5:8080');
    const links = await provideLinks(term, { onHost });
    expect(links.some((l) => l.text === '10.0.0.5:8080')).toBe(true);
  });

  it('Activate handler tıklamayla doğru fonksiyonu çağırır', async () => {
    const onPath = vi.fn();
    const onHost = vi.fn();
    const term = makeTerm('check /etc/hosts then ping 8.8.8.8');
    const links = await provideLinks(term, { onPath, onHost });
    const pathLink = links.find((l) => l.text.startsWith('/etc/'))!;
    const ipLink = links.find((l) => l.text === '8.8.8.8')!;
    pathLink.activate({} as MouseEvent, pathLink.text);
    ipLink.activate({} as MouseEvent, ipLink.text);
    expect(onPath).toHaveBeenCalledWith('/etc/hosts');
    expect(onHost).toHaveBeenCalledWith('8.8.8.8');
  });

  it('Hiçbir pattern eşleşmezse boş döner', async () => {
    const term = makeTerm('just plain text with no links');
    const links = await provideLinks(term, {});
    expect(links).toEqual([]);
  });

  it('Range satır içi 1-based start/end kolonu doğru hesaplar', async () => {
    const term = makeTerm('xxx /a/b xxx');
    const links = await provideLinks(term, {});
    const link = links.find((l) => l.text === '/a/b');
    expect(link).toBeDefined();
    expect(link!.range.start.x).toBe(5); // 'xxx ' sonrası 1-based
    expect(link!.range.end.x).toBe(8);
  });
});
