// Frontend logger — console + Tauri command (Rust dosya'ya yazar).
//
// Kullanım:
//   const log = createLogger('panes');
//   log.info('opened pane', { id: 'foo' });
//   log.error('spawn failed', { error: e });

import { invoke } from '@tauri-apps/api/core';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

const CONSOLE_FN: Record<LogLevel, (...args: unknown[]) => void> = {
  trace: console.debug.bind(console),
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

const COLOR: Record<LogLevel, string> = {
  trace: 'color: #5a6478',
  debug: 'color: #00b4d8',
  info:  'color: #28c840',
  warn:  'color: #ffbd2e',
  error: 'color: #ff5f57; font-weight: bold',
};

let minLevel: LogLevel = 'info';
let bridgeEnabled = true;

export function setMinLevel(level: LogLevel) {
  minLevel = level;
}

export function setBridgeEnabled(enabled: boolean) {
  bridgeEnabled = enabled;
}

interface BridgeEvent {
  level: LogLevel;
  source: string;
  message: string;
  fields: Record<string, unknown> | null;
}

async function sendToBridge(event: BridgeEvent) {
  if (!bridgeEnabled) return;
  try {
    await invoke('log_event', { event });
  } catch {
    // Backend henüz hazır değilse veya offline — sessiz geç
  }
}

export interface Logger {
  trace: (msg: string, fields?: Record<string, unknown>) => void;
  debug: (msg: string, fields?: Record<string, unknown>) => void;
  info:  (msg: string, fields?: Record<string, unknown>) => void;
  warn:  (msg: string, fields?: Record<string, unknown>) => void;
  error: (msg: string, fields?: Record<string, unknown>) => void;
}

export function createLogger(source: string): Logger {
  function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>) {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    const styled = `%c[${level}]%c ${source}: ${msg}`;
    const fieldArgs = fields && Object.keys(fields).length > 0 ? [fields] : [];
    CONSOLE_FN[level](styled, COLOR[level], 'color: inherit', ...fieldArgs);
    void sendToBridge({ level, source, message: msg, fields: fields ?? null });
  }
  return {
    trace: (m, f) => emit('trace', m, f),
    debug: (m, f) => emit('debug', m, f),
    info:  (m, f) => emit('info',  m, f),
    warn:  (m, f) => emit('warn',  m, f),
    error: (m, f) => emit('error', m, f),
  };
}

/** Yakalanmamış JS hatalarını log'a yansıt — main.ts'de bir kere çağrılır. */
export function installGlobalErrorHandlers() {
  const log = createLogger('window');
  window.addEventListener('error', (e) => {
    log.error(e.message, {
      filename: e.filename,
      line: e.lineno,
      col: e.colno,
      stack: e.error?.stack,
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    log.error('unhandled promise rejection', {
      reason: String(e.reason),
      stack: e.reason?.stack,
    });
  });
}
