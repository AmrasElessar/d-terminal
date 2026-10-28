// Shell integration — OSC 133 (block/prompt), OSC 7 (cwd), OSC 9999 (Agent
// Watch) handler'ları ve satır tabanlı trigger/agent detector beslemesi.
//
// Tüm OSC verisi terminal çıktısından gelir ve GÜVENİLMEZDİR (`cat` edilen bir
// dosya, ssh oturumu, herhangi bir program bu dizileri basabilir). Parse
// fonksiyonları doğrulama yapar; handler'lar asla fırlatmamalıdır (xterm
// parser'ı içinde exception çıktıyı bozar).

import type { IDisposable, Terminal } from '@xterm/xterm';
import type { BlockTracker } from '@/composables/useBlocks';
import { parseAgentEvent, type AgentEvent } from '@/types/agent';
import { parseOsc7CwdPayload } from '@/composables/useGitStat';
import { stripAnsi } from '@/utils/ansi';

export interface ShellIntegrationContext {
  blocks: BlockTracker;
  /** A/B — yeni prompt / komut girişi; komut tamponu sıfırlanmalı. */
  onPromptBoundary(): void;
  /** D — komut bitti; geçmişe yazılabilir komut (redacte/private süzülmüş). */
  onCommandFinished(command: string, exitCode: number, durationMs: number | undefined): void;
  onCwd(path: string): void;
  onAgentEvent(ev: AgentEvent): void;
}

export function installShellIntegration(term: Terminal, ctx: ShellIntegrationContext): IDisposable[] {
  const out: IDisposable[] = [];

  // OSC 133 — Final Term protocol:
  //   A → prompt start, B → command input, C → command run, D[;exit] → end,
  //   P;cwd=<x> → cwd metadata.
  out.push(
    term.parser.registerOscHandler(133, (data: string) => {
      try {
        const semi = data.indexOf(';');
        const cmd = semi >= 0 ? data.slice(0, semi) : data;
        const rest = semi >= 0 ? data.slice(semi + 1) : '';
        switch (cmd) {
          case 'A':
            ctx.blocks.onPromptStart();
            ctx.onPromptBoundary();
            break;
          case 'B':
            ctx.blocks.onCommandStart();
            ctx.onPromptBoundary();
            break;
          case 'C':
            ctx.blocks.onCommandRun('');
            break;
          case 'D': {
            const parsed = rest ? parseInt(rest, 10) : 0;
            const code = Number.isNaN(parsed) ? 0 : parsed;
            ctx.blocks.onCommandEnd(code);
            const block = ctx.blocks.active();
            const cmdText = block ? ctx.blocks.historyCommand(block) : null;
            if (block && cmdText) {
              const dur = block.endedAt && block.startedAt
                ? block.endedAt.getTime() - block.startedAt.getTime()
                : undefined;
              ctx.onCommandFinished(cmdText, code, dur);
            }
            break;
          }
          case 'P': {
            const m = /^cwd=(.{1,4096})$/.exec(rest);
            if (m) ctx.blocks.onCwd(m[1]!);
            break;
          }
        }
      } catch (e) {
        console.warn('OSC 133 handler:', e);
      }
      return true;
    }),
  );

  // OSC 7 — cwd bildirimi (`file://host/path`). Yalnızca doğrulanmış yerel
  // sürücü yolları kabul edilir (UNC → NTLM hash sızıntısı).
  out.push(
    term.parser.registerOscHandler(7, (data) => {
      const path = parseOsc7CwdPayload(data);
      if (path) ctx.onCwd(path);
      return true;
    }),
  );

  // OSC 9999 — Agent Watch protokolü (şema doğrulamalı).
  out.push(
    term.parser.registerOscHandler(9999, (data) => {
      const ev = parseAgentEvent(data);
      if (!ev) return true; // bozuk payload — yut, ekrana basma
      try {
        ctx.onAgentEvent(ev);
      } catch (e) {
        console.warn('OSC 9999 dispatch:', e);
      }
      return true;
    }),
  );

  return out;
}

/** Satır tabanlı çıktı besleyici — chunk'lar `\n` sınırında satırlara bölünür,
 *  eksik son parça bir sonraki chunk ile birleşir. ANSI temizlenir. Tek satır
 *  `maxLine` karakteri aşarsa (newline'sız dev çıktı) zorla flush edilir. */
export function createLineFeeder(opts: {
  onChunk?: (stripped: string) => void;
  onLine: (line: string) => void;
  maxLine?: number;
}) {
  const maxLine = opts.maxLine ?? 16 * 1024;
  let pendingLine = '';
  return {
    feed(text: string) {
      if (!text) return;
      const stripped = stripAnsi(text);
      opts.onChunk?.(stripped);
      pendingLine += stripped;
      if (!pendingLine.includes('\n')) {
        if (pendingLine.length > maxLine) {
          opts.onLine(pendingLine.slice(-maxLine));
          pendingLine = '';
        }
        return;
      }
      const parts = pendingLine.split('\n');
      pendingLine = parts.pop() ?? '';
      for (const raw of parts) {
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        if (line.length > 0) opts.onLine(line);
      }
    },
    reset() {
      pendingLine = '';
    },
  };
}
